import { randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'

import { parseTabId, safeConnectionLabel, validConnectionId } from './connection.js'
import { isLocalBrokerSocketPath, writeRuntimeStatus } from './runtime.js'
import type { ChromeBridgeRequest, ChromeBridgeRequestRouter } from './server.js'

const IPC_REQUEST_MAX_BYTES = 1024 * 1024
const IPC_RESPONSE_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_PENDING = 32
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 2_000

export interface BrokerConfig {
  /** Explicit client enrollment; never reuse the native-host token. */
  clientTokens?: Record<string, string>
  handshakeTimeoutMs?: number
  maxPending?: number
  origin: string
  requestTimeoutMs?: number
  socketPath: string
  statusPath?: string
  token: string
  version: 1
}

export interface BrokerStatus {
  connections: ConnectionStatus[]
  connectionCount: number
  bridgeConnected: boolean
  connected: boolean
  connectedAt?: string
  disconnectedAt?: string
  nativeConnected: boolean
  updatedAt: string
  version: 1
}

interface ConnectionStatus {
  connectionId: string
  label: string
  sessionId: string
  connectedAt: string
}

interface HostConnection extends ConnectionStatus {
  socket: Socket
  pending: Map<string, PendingRequest>
  retired: Set<string>
  leases: Map<number, string>
}

interface PendingRequest {
  reject: (error: BridgeBrokerError) => void
  resolve: (value: unknown) => void
  timer: NodeJS.Timeout
}

interface Envelope {
  [key: string]: unknown
  type: string
}

export class BridgeBrokerError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'BridgeBrokerError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseEnvelope(line: Buffer): Envelope {
  let text: string

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(line)
  } catch {
    throw new BridgeBrokerError('INVALID_ENVELOPE', 'IPC envelope contains invalid UTF-8')
  }

  let value: unknown

  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new BridgeBrokerError('INVALID_ENVELOPE', 'IPC envelope is not valid JSON')
  }

  if (!isObject(value) || typeof value.type !== 'string') {
    throw new BridgeBrokerError('INVALID_ENVELOPE', 'IPC envelope must be an object with a type')
  }

  return value as Envelope
}

function tokensEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') {return false}
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)

  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  try {
    const info = await lstat(socketPath)

    if (!info.isSocket()) {
      throw new Error(`refusing to replace non-socket broker path: ${socketPath}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return}
    throw error
  }

  const active = await new Promise<boolean>((resolve, reject) => {
    const probe = createConnection(socketPath)
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', error => {
      const code = (error as NodeJS.ErrnoException).code

      if (code === 'ECONNREFUSED' || code === 'ENOENT') {resolve(false)}
      else {reject(error)}
    })
  })

  if (active) {throw new Error(`Chrome bridge broker is already active at ${socketPath}`)}
  await unlink(socketPath).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
  })
}

export interface BrokerClientConfig {
  socketPath: string
  clientId: string
  token: string
  version: 1
  requestTimeoutMs?: number
}

export interface BrokerClient extends ChromeBridgeRequestRouter {
  releaseControl(tabId: string): Promise<void>
  route(request: ChromeBridgeRequest, signal?: AbortSignal): Promise<unknown>
  close(): Promise<void>
}

/** Attach only using an explicitly issued client credential, never a host config. */
function routeTimeoutMs(request: ChromeBridgeRequest, ordinary: number, margin: number): number {
  if (request.method !== 'control' || request.arguments.action !== 'download') { return ordinary }
  const requested = request.arguments.timeoutMs
  const operation = typeof requested === 'number' && Number.isFinite(requested) ? Math.max(1000, Math.min(60_000, requested)) : 30_000

  return Math.max(ordinary, operation + margin)
}

export async function connectBrokerClient(config: BrokerClientConfig): Promise<BrokerClient> {
  if (!isLocalBrokerSocketPath(config.socketPath)) { throw new BridgeBrokerError('INVALID_ARGUMENTS', 'shared broker endpoint must be local') }
  const socket = createConnection(config.socketPath)
  const pending = new Map<string, PendingRequest>()
  let buffer: Buffer = Buffer.alloc(0)
  let ready = false
  let accept!: () => void
  let reject!: (error: Error) => void
  const handshake = new Promise<void>((resolve, fail) => { accept = resolve; reject = fail })

  const fail = (error: BridgeBrokerError): void => {
    reject(error)

    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
    pending.clear()
    socket.destroy()
  }

  const timer = setTimeout(() => fail(new BridgeBrokerError('AUTH_REJECTED', 'client handshake timed out')), DEFAULT_HANDSHAKE_TIMEOUT_MS)
  socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'client.hello', clientId: config.clientId, token: config.token, version: config.version })}\n`))
  socket.on('error', () => fail(new BridgeBrokerError('BRIDGE_DISCONNECTED', 'shared broker unavailable')))
  socket.on('close', () => fail(new BridgeBrokerError('BRIDGE_DISCONNECTED', 'shared broker disconnected')))
  socket.on('data', chunk => {
    try {
      buffer = Buffer.concat([buffer, chunk])

      for (;;) {
        const newline = buffer.indexOf(0x0a)

        if (newline < 0) {
          if (buffer.length > IPC_RESPONSE_MAX_BYTES) { throw new Error('oversize') }

          break
        }

        if (newline > IPC_RESPONSE_MAX_BYTES) { throw new Error('oversize') }
        const envelope = parseEnvelope(buffer.subarray(0, newline))
        buffer = buffer.subarray(newline + 1)

        if (envelope.type === 'error') {
          fail(new BridgeBrokerError(typeof envelope.code === 'string' ? envelope.code : 'AUTH_REJECTED', 'shared broker rejected client'))

          return
        }

        if (!ready) {
          if (envelope.type !== 'hello.ok' || envelope.version !== 1) { throw new Error('handshake') }
          ready = true
          accept()

          continue
        }

        if (envelope.type !== 'response' || typeof envelope.id !== 'string') { throw new Error('response') }
        const item = pending.get(envelope.id)

        if (item === undefined) { continue }
        pending.delete(envelope.id)
        clearTimeout(item.timer)

        if (isObject(envelope.error)) {
          item.reject(new BridgeBrokerError(typeof envelope.error.code === 'string' ? envelope.error.code : 'BRIDGE_ERROR', 'shared broker request failed'))
        } else if ('result' in envelope) { item.resolve(envelope.result) }
        else { item.reject(new BridgeBrokerError('INVALID_ENVELOPE', 'invalid broker response')) }
      }
    } catch { fail(new BridgeBrokerError('INVALID_ENVELOPE', 'invalid broker response')) }
  })

  try { await handshake } finally { clearTimeout(timer) }

  return {
    async releaseControl(this: BrokerClient, tabId) {
      await this.route({ method: 'control.release' as ChromeBridgeRequest['method'], arguments: { tabId } })
    },
    async close() { fail(new BridgeBrokerError('BRIDGE_DISCONNECTED', 'client closed')) },
    async route(request, signal) {
      if (signal?.aborted) { throw new BridgeBrokerError('REQUEST_CANCELLED', 'request cancelled') }

      if (socket.destroyed) { throw new BridgeBrokerError('BRIDGE_DISCONNECTED', 'shared broker disconnected') }

      if (pending.size >= DEFAULT_MAX_PENDING) { throw new BridgeBrokerError('BRIDGE_BUSY', 'too many pending client requests') }
      const id = randomUUID()
      const encoded = `${JSON.stringify({ ...request, id, type: 'request' })}\n`

      if (Buffer.byteLength(encoded) > IPC_REQUEST_MAX_BYTES) { throw new BridgeBrokerError('INVALID_ENVELOPE', 'client request too large') }

      return new Promise((resolve, rejectRequest) => {
        const requestTimer = setTimeout(() => {
          const item = pending.get(id)
          pending.delete(id)
          socket.write(`${JSON.stringify({ type: 'cancel', id })}\n`)
          item?.reject(new BridgeBrokerError('BRIDGE_TIMEOUT', 'shared broker request timed out'))
        }, routeTimeoutMs(request, config.requestTimeoutMs ?? 10_000, 4000))

        const abort = (): void => {
          if (!pending.has(id)) { return }
          pending.delete(id)
          clearTimeout(requestTimer)
          socket.write(`${JSON.stringify({ type: 'cancel', id })}\n`)
          rejectRequest(new BridgeBrokerError('REQUEST_CANCELLED', 'request cancelled'))
        }

        const cleanup = (): void => signal?.removeEventListener('abort', abort)
        pending.set(id, {
          resolve: value => { cleanup(); resolve(value) },
          reject: error => { cleanup(); rejectRequest(error) }, timer: requestTimer
        })
        signal?.addEventListener('abort', abort, { once: true })
        socket.write(encoded)
      })
    }
  }
}

export class ChromeBridgeBroker implements ChromeBridgeRequestRouter {
  private readonly localControllerId = randomUUID()
  private hosts = new Map<string, HostConnection>()
  private sockets = new Set<Socket>()
  private implicitSession?: string
  private requiresExplicitConnection = false
  private connectedAt?: string
  private disconnectedAt?: string

  private server?: Server
  private statusWrites: Promise<void> = Promise.resolve()

  public constructor(private readonly config: BrokerConfig) {
    if (config.version !== 1) {throw new Error('unsupported Chrome bridge protocol version')}
  }

  public async start(): Promise<void> {
    if (process.platform === 'win32') {
      if (!this.config.socketPath.startsWith('\\\\.\\pipe\\hermes-chrome-bridge-')) { throw new Error('Windows broker requires a local Hermes named pipe') }
    } else { await removeStaleSocket(this.config.socketPath) }

    this.server = createServer(socket => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(this.config.socketPath, resolve)
    })

    if (process.platform !== 'win32') { await chmod(this.config.socketPath, 0o600) }
    this.persistStatus()
  }

  public status(): BrokerStatus {
    const connections = [...this.hosts.values()].map(({ connectionId, label, sessionId, connectedAt }) =>
      ({ connectionId, label, sessionId, connectedAt }))
      .sort((left, right) => left.connectionId.localeCompare(right.connectionId))

    return {
      connections,
      connectionCount: connections.length,
      bridgeConnected: connections.length > 0,
      connected: connections.length > 0,
      ...(this.connectedAt === undefined ? {} : { connectedAt: this.connectedAt }),
      ...(this.disconnectedAt === undefined ? {} : { disconnectedAt: this.disconnectedAt }),
      nativeConnected: connections.length > 0,
      updatedAt: new Date().toISOString(),
      version: 1
    }
  }

  public async releaseControl(tabId: string): Promise<void> {
    this.releaseClientControl(tabId, this.localControllerId)
  }

  private releaseClientControl(tabId: string, controllerId: string): void {
    const tab = parseTabId(tabId)
    const host = tab === undefined ? undefined : this.hosts.get(tab.connectionId)

    if (tab === undefined || host?.sessionId !== tab.sessionId) { throw new BridgeBrokerError('STALE_TAB_ID', 'rediscover tabs before releasing control') }
    const owner = host.leases.get(tab.tabId)

    if (owner !== undefined && owner !== controllerId) { throw new BridgeBrokerError('TAB_BUSY', 'tab is controlled by another client') }
    host.leases.delete(tab.tabId)
  }

  public async route(request: ChromeBridgeRequest, signal?: AbortSignal): Promise<unknown> {
    return this.routeForClient(request, signal, this.localControllerId)
  }

  private async routeForClient(request: ChromeBridgeRequest, signal: AbortSignal | undefined, controllerId: string): Promise<unknown> {
    if (signal?.aborted) { throw new BridgeBrokerError('REQUEST_CANCELLED', 'request cancelled') }

    if (request.method === 'status' && request.arguments.connectionId === undefined) { return this.status() }
    const arguments_ = { ...request.arguments }
    const tab = parseTabId(arguments_.tabId)
    const explicitId = arguments_.connectionId

    if (explicitId !== undefined && !validConnectionId(explicitId)) {
      throw new BridgeBrokerError('INVALID_ARGUMENTS', 'invalid connectionId')
    }

    if (typeof arguments_.tabId === 'string' && tab === undefined) {
      throw new BridgeBrokerError('INVALID_ARGUMENTS', 'invalid namespaced tabId')
    }

    if (tab !== undefined && explicitId !== undefined && explicitId !== tab.connectionId) {
      throw new BridgeBrokerError('CONNECTION_MISMATCH', 'tabId belongs to another connection')
    }

    const connectionId = explicitId ?? tab?.connectionId
    let selected: HostConnection | undefined

    if (connectionId !== undefined) {
      selected = this.hosts.get(connectionId)
    } else {
      if (this.hosts.size > 1 || this.requiresExplicitConnection) {
        throw new BridgeBrokerError('AMBIGUOUS_CONNECTION', 'Use connectionId from chrome_bridge_status or a namespaced tabId')
      }

      selected = this.hosts.values().next().value
    }

    if (selected === undefined || selected.socket.destroyed) {
      throw new BridgeBrokerError('BRIDGE_DISCONNECTED', 'native Chrome bridge is disconnected')
    }

    const host = selected

    if (tab !== undefined && tab.sessionId !== host.sessionId) {
      throw new BridgeBrokerError('STALE_TAB_ID', 'Connection reconnected; rediscover its tabs')
    }

    delete arguments_.connectionId

    if (tab !== undefined) { arguments_.tabId = tab.tabId }

    if (host.pending.size >= (this.config.maxPending ?? DEFAULT_MAX_PENDING)) {
      throw new BridgeBrokerError('BRIDGE_BUSY', 'native Chrome bridge has too many pending requests')
    }

    // Unknown/new actions fail closed as mutations until explicitly classified read-only.
    const mutation = !['console', 'query', 'screenshot', 'snapshot', 'status', 'tabs'].includes(request.method)

    if (mutation && Number.isSafeInteger(arguments_.tabId)) {
      const tabId = arguments_.tabId as number
      const owner = host.leases.get(tabId)

      if (owner !== undefined && owner !== controllerId) { throw new BridgeBrokerError('TAB_BUSY', 'tab is controlled by another client') }
      host.leases.set(tabId, controllerId)
    }

    const id = randomUUID()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const item = host.pending.get(id)
        host.pending.delete(id)
        retire()
        this.send(host.socket, { type: 'cancel', id, controllerId })
        item?.reject(new BridgeBrokerError('BRIDGE_TIMEOUT', 'native Chrome bridge request timed out'))
      }, routeTimeoutMs(request, this.config.requestTimeoutMs ?? 10_000, 2000))

      const retire = (): void => {
        host.retired.add(id)

        if (host.retired.size > 1024) { host.retired.delete(host.retired.values().next().value!) }
      }

      const abort = (): void => {
        const item = host.pending.get(id)

        if (item === undefined) { return }
        host.pending.delete(id)
        clearTimeout(timer)
        retire()
        this.send(host.socket, { type: 'cancel', id, controllerId })
        item.reject(new BridgeBrokerError('REQUEST_CANCELLED', 'request cancelled'))
      }

      const cleanup = (): void => signal?.removeEventListener('abort', abort)
      host.pending.set(id, {
        reject: error => { cleanup(); reject(error) },
        resolve: value => { cleanup(); resolve(this.scopeResult(host, value)) }, timer
      })
      signal?.addEventListener('abort', abort, { once: true })

      try {
        this.send(host.socket, { arguments: arguments_, controllerId, id, method: request.method, type: 'request' })
      } catch (error) {
        clearTimeout(timer)
        host.pending.delete(id)
        reject(error)
      }
    })
  }

  public async close(): Promise<void> {
    for (const host of this.hosts.values()) { this.disconnectHost(host, 'broker closed') }

    for (const socket of this.sockets) { socket.destroy() }
    await this.statusWrites

    if (this.server !== undefined) {
      await new Promise<void>(resolve => this.server?.close(() => resolve()))
      this.server = undefined
    }

    if (process.platform === 'win32') { return }
    await unlink(this.config.socketPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
    })
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket)
    let host: HostConnection | undefined
    let authenticated = false
    let client = false
    const controllerId = randomUUID()
    const clientRequests = new Map<string, AbortController>()
    let buffer = Buffer.alloc(0)

    const handshakeTimer = setTimeout(() => {
      this.rejectSocket(socket, 'AUTH_REJECTED', 'authentication timed out')
    }, this.config.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS)

    socket.on('data', chunk => {
      if (socket.writableEnded || socket.destroyed) { return }

      try {
        buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])

        for (;;) {
          const newline = buffer.indexOf(0x0a)
          const maxBytes = authenticated && !client ? IPC_RESPONSE_MAX_BYTES : IPC_REQUEST_MAX_BYTES

          if (newline === -1) {
            if (buffer.length > maxBytes) {
              throw new BridgeBrokerError('INVALID_ENVELOPE', 'IPC envelope exceeds size limit')
            }

            break
          }

          const line = buffer.subarray(0, newline)
          buffer = buffer.subarray(newline + 1)

          if (line.length === 0) {continue}

          if (line.length > maxBytes) {
            throw new BridgeBrokerError('INVALID_ENVELOPE', 'IPC envelope exceeds size limit')
          }

          const envelope = parseEnvelope(line)

          if (!authenticated && envelope.type === 'client.hello') {
            const expected = typeof envelope.clientId === 'string' && Object.hasOwn(this.config.clientTokens ?? {}, envelope.clientId)
              ? this.config.clientTokens?.[envelope.clientId] : undefined

            if (envelope.version !== 1 || expected === undefined || expected === this.config.token || !tokensEqual(envelope.token, expected)) {
              clearTimeout(handshakeTimer)
              this.rejectSocket(socket, 'AUTH_REJECTED', 'client enrollment rejected')

              return
            }

            authenticated = true
            client = true
            clearTimeout(handshakeTimer)
            this.send(socket, { type: 'hello.ok', version: 1 })

            continue
          }

          if (client) {
            if (envelope.type === 'cancel' && typeof envelope.id === 'string') {
              clientRequests.get(envelope.id)?.abort()
              clientRequests.delete(envelope.id)

              continue
            }

            if (envelope.type !== 'request' || typeof envelope.id !== 'string' || envelope.id.length > 128 ||
                typeof envelope.method !== 'string' || !isObject(envelope.arguments) || clientRequests.has(envelope.id)) {
              throw new BridgeBrokerError('INVALID_ENVELOPE', 'invalid client request')
            }

            if (clientRequests.size >= (this.config.maxPending ?? DEFAULT_MAX_PENDING)) {
              throw new BridgeBrokerError('BRIDGE_BUSY', 'too many client requests')
            }

            const id = envelope.id
            const controller = new AbortController()

            const pending = envelope.method === 'control.release'
              ? Promise.resolve().then(() => {
                this.releaseClientControl(String((envelope.arguments as Record<string, unknown>).tabId), controllerId)

                return { released: true }
              })
              : this.routeForClient({ method: envelope.method as ChromeBridgeRequest['method'], arguments: envelope.arguments }, controller.signal, controllerId)

            clientRequests.set(id, controller)
            void pending.then(result => {
              if (!socket.destroyed && !socket.writableEnded) { socket.write(`${JSON.stringify({ type: 'response', id, result })}\n`) }
            }, (error: unknown) => {
              if (!socket.destroyed && !socket.writableEnded) { this.send(socket, { type: 'response', id, error: { code: error instanceof BridgeBrokerError ? error.code : 'BRIDGE_ERROR', message: 'shared broker request failed' } }) }
            }).finally(() => {
              if (clientRequests.get(id) === controller) { clientRequests.delete(id) }
            })

            continue
          }

          if (!authenticated) {
            if (envelope.type !== 'hello' || !this.validHello(envelope)) {
              clearTimeout(handshakeTimer)
              this.rejectSocket(socket, 'AUTH_REJECTED', 'invalid token, origin, or version')

              return
            }

            // Old hosts remain usable but their identity cannot survive reconnect.
            const connectionId = envelope.connectionId === undefined ? randomUUID() : envelope.connectionId

            if (!validConnectionId(connectionId)) {
              throw new BridgeBrokerError('INVALID_ENVELOPE', 'invalid public connection identity')
            }

            if (this.hosts.has(connectionId)) {
              clearTimeout(handshakeTimer)
              this.rejectSocket(socket, 'CONNECTION_ALREADY_CONNECTED', 'this identity is already connected; disconnect it before retrying')

              return
            }

            authenticated = true
            clearTimeout(handshakeTimer)
            this.connectedAt = new Date().toISOString()
            host = {
              connectionId,
              label: safeConnectionLabel(envelope.label, connectionId),
              sessionId: randomUUID(),
              connectedAt: this.connectedAt,
              pending: new Map(),
              retired: new Set(),
              leases: new Map(),
              socket
            }
            this.hosts.set(connectionId, host)

            // Bind the default at discovery, before any command can race a
            // disconnect/replacement. Never silently promote another profile.
            if (this.implicitSession === undefined) { this.implicitSession = host.sessionId }
            else { this.requiresExplicitConnection = true }

            this.persistStatus()
            this.send(socket, { type: 'hello.ok', version: 1 })
          } else if (host !== undefined) {
            this.handleHostEnvelope(host, envelope)
          }
        }
      } catch (error) {
        clearTimeout(handshakeTimer)

        const brokerError = error instanceof BridgeBrokerError
          ? error : new BridgeBrokerError('INVALID_ENVELOPE', 'invalid IPC envelope')

        this.rejectSocket(socket, brokerError.code, brokerError.message)

        if (host !== undefined) {this.disconnectHost(host, brokerError.message)}
      }
    })
    socket.on('close', () => {
      clearTimeout(handshakeTimer)
      this.sockets.delete(socket)

      for (const controller of clientRequests.values()) { controller.abort() }
      clientRequests.clear()

      for (const connected of this.hosts.values()) {
        for (const [tabId, owner] of connected.leases) {
          if (owner === controllerId) { connected.leases.delete(tabId) }
        }
      }

      if (host !== undefined) {this.disconnectHost(host, 'native host disconnected')}
    })
    socket.on('error', () => {
      if (host !== undefined) {this.disconnectHost(host, 'native host disconnected')}
    })
  }

  private validHello(envelope: Envelope): boolean {
    return envelope.version === this.config.version &&
      envelope.origin === this.config.origin && tokensEqual(envelope.token, this.config.token)
  }

  private handleHostEnvelope(host: HostConnection, envelope: Envelope): void {
    if (envelope.type === 'event' && isObject(envelope.event)) {return}

    if (envelope.type !== 'response' || typeof envelope.id !== 'string') {
      throw new BridgeBrokerError('INVALID_ENVELOPE', 'host sent an invalid response envelope')
    }

    const pending = host.pending.get(envelope.id)

    if (host.retired.delete(envelope.id)) { return }

    if (pending === undefined) {
      throw new BridgeBrokerError('INVALID_ENVELOPE', 'host response has an unknown request ID')
    }

    const invalidResponse = !(
      (isObject(envelope.error) && typeof envelope.error.message === 'string') || 'result' in envelope
    )

    if (invalidResponse) {
      const error = new BridgeBrokerError('INVALID_ENVELOPE', 'host response has no result or error')
      host.pending.delete(envelope.id)
      clearTimeout(pending.timer)
      pending.reject(error)
      throw error
    }

    host.pending.delete(envelope.id)
    clearTimeout(pending.timer)

    if (isObject(envelope.error) && typeof envelope.error.message === 'string') {
      pending.reject(new BridgeBrokerError(
        typeof envelope.error.code === 'string' ? envelope.error.code : 'BRIDGE_ERROR', envelope.error.message
      ))
    } else {
      pending.resolve(envelope.result)
    }
  }

  private disconnectHost(host: HostConnection, reason: string): void {
    if (this.hosts.get(host.connectionId) !== host) { return }
    this.hosts.delete(host.connectionId)

    if (!host.socket.destroyed) {host.socket.destroy()}
    this.disconnectedAt = new Date().toISOString()

    for (const [id, pending] of host.pending) {
      clearTimeout(pending.timer)
      pending.reject(new BridgeBrokerError('BRIDGE_DISCONNECTED', reason))
      host.pending.delete(id)
    }

    this.persistStatus()
  }

  private persistStatus(): void {
    const path = this.config.statusPath

    if (path === undefined) { return }
    const status = this.status()
    this.statusWrites = this.statusWrites.then(async () => writeRuntimeStatus(path, status))
      .catch(() => { process.stderr.write('Chrome bridge could not persist broker status\n') })
  }

  private scopeResult(host: HostConnection, value: unknown): unknown {
    // Only protocol tab fields, never similarly named fields inside page/eval data.
    if (!isObject(value)) { return value }
    const result: Record<string, unknown> = { ...value, connectionId: host.connectionId }

    for (const key of ['tabId', 'selectedTabId']) {
      if (Number.isSafeInteger(value[key]) && (value[key] as number) > 0) {
        result[key] = `${host.connectionId}:${host.sessionId}:${String(value[key])}`
      }
    }

    if (Array.isArray(value.tabs)) { result.tabs = value.tabs.map(tab => this.scopeResult(host, tab)) }

    return result
  }

  private rejectSocket(socket: Socket, code: string, message: string): void {
    if (!socket.destroyed) {socket.end(`${JSON.stringify({ code, message, type: 'error' })}\n`)}
  }

  private send(socket: Socket, envelope: Record<string, unknown>): void {
    const encoded = Buffer.from(JSON.stringify(envelope), 'utf8')

    if (encoded.length > IPC_REQUEST_MAX_BYTES) {
      throw new BridgeBrokerError('INVALID_ENVELOPE', 'outbound IPC envelope exceeds size limit')
    }

    socket.write(Buffer.concat([encoded, Buffer.from('\n')]))
  }
}
