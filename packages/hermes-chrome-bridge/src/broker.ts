import { randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'

import { parseTabId, safeConnectionLabel, validConnectionId } from './connection.js'
import { writeRuntimeStatus } from './runtime.js'
import type { ChromeBridgeRequest, ChromeBridgeRequestRouter } from './server.js'

const IPC_REQUEST_MAX_BYTES = 1024 * 1024
const IPC_RESPONSE_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_PENDING = 32
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 2_000

export interface BrokerConfig {
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

export class ChromeBridgeBroker implements ChromeBridgeRequestRouter {
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
      throw new Error('Windows broker requires a supported signed native launcher')
    }

    await removeStaleSocket(this.config.socketPath)
    this.server = createServer(socket => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(this.config.socketPath, resolve)
    })
    await chmod(this.config.socketPath, 0o600)
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

  public async route(request: ChromeBridgeRequest): Promise<unknown> {
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

    const id = randomUUID()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        host.pending.delete(id)
        reject(new BridgeBrokerError('BRIDGE_TIMEOUT', 'native Chrome bridge request timed out'))
      }, this.config.requestTimeoutMs ?? 10_000)

      host.pending.set(id, { reject, resolve: value => resolve(this.scopeResult(host, value)), timer })

      try {
        this.send(host.socket, { arguments: arguments_, id, method: request.method, type: 'request' })
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

    await unlink(this.config.socketPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
    })
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket)
    let host: HostConnection | undefined
    let authenticated = false
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
          const maxBytes = authenticated ? IPC_RESPONSE_MAX_BYTES : IPC_REQUEST_MAX_BYTES

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
