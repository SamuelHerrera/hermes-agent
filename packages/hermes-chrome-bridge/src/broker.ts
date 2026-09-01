import { timingSafeEqual } from 'node:crypto'
import { chmod, lstat, unlink } from 'node:fs/promises'
import {
  createConnection,
  createServer,
  type Server,
  type Socket
} from 'node:net'

import type {
  ChromeBridgeRequest,
  ChromeBridgeRequestRouter
} from './server.js'

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
  token: string
  version: 1
}

export interface BrokerStatus {
  bridgeConnected: boolean
  connected: boolean
  connectedAt?: string
  disconnectedAt?: string
  nativeConnected: boolean
  updatedAt: string
  version: 1
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
  private activeHost?: Socket
  private connectedAt?: string
  private disconnectedAt?: string
  private nextRequestId = 1
  private pending = new Map<string, PendingRequest>()
  private server?: Server

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
  }

  public status(): BrokerStatus {
    return {
      bridgeConnected: this.activeHost !== undefined,
      connected: this.activeHost !== undefined,
      ...(this.connectedAt === undefined ? {} : { connectedAt: this.connectedAt }),
      ...(this.disconnectedAt === undefined ? {} : { disconnectedAt: this.disconnectedAt }),
      nativeConnected: this.activeHost !== undefined,
      updatedAt: new Date().toISOString(),
      version: 1
    }
  }

  public async route(request: ChromeBridgeRequest): Promise<unknown> {
    if (this.activeHost === undefined || this.activeHost.destroyed) {
      if (request.method === 'status') { return this.status() }
      throw new BridgeBrokerError('BRIDGE_DISCONNECTED', 'native Chrome bridge is disconnected')
    }

    const maxPending = this.config.maxPending ?? DEFAULT_MAX_PENDING

    if (this.pending.size >= maxPending) {
      throw new BridgeBrokerError('BRIDGE_BUSY', 'native Chrome bridge has too many pending requests')
    }

    const id = String(this.nextRequestId++)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BridgeBrokerError('BRIDGE_TIMEOUT', 'native Chrome bridge request timed out'))
      }, this.config.requestTimeoutMs ?? 10_000)

      this.pending.set(id, { reject, resolve, timer })
      this.send(this.activeHost as Socket, {
        arguments: request.arguments,
        id,
        method: request.method,
        type: 'request'
      })
    })
  }

  public async close(): Promise<void> {
    this.disconnectHost('broker closed')

    if (this.server !== undefined) {
      await new Promise<void>(resolve => this.server?.close(() => resolve()))
      this.server = undefined
    }

    await unlink(this.config.socketPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
    })
  }

  private accept(socket: Socket): void {
    let authenticated = false
    let buffer = Buffer.alloc(0)

    const handshakeTimer = setTimeout(() => {
      this.rejectSocket(socket, 'AUTH_REJECTED', 'authentication timed out')
    }, this.config.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS)

    socket.on('data', chunk => {
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

            if (this.activeHost !== undefined) {
              clearTimeout(handshakeTimer)
              this.rejectSocket(socket, 'HOST_ALREADY_CONNECTED', 'an authenticated host is already connected')

              return
            }

            authenticated = true
            clearTimeout(handshakeTimer)
            this.activeHost = socket
            this.connectedAt = new Date().toISOString()
            this.send(socket, { type: 'hello.ok', version: 1 })
          } else {
            this.handleHostEnvelope(envelope)
          }
        }
      } catch (error) {
        clearTimeout(handshakeTimer)

        const brokerError = error instanceof BridgeBrokerError
          ? error
          : new BridgeBrokerError('INVALID_ENVELOPE', 'invalid IPC envelope')

        this.rejectSocket(socket, brokerError.code, brokerError.message)

        if (authenticated) {this.disconnectHost(brokerError.message)}
      }
    })
    socket.on('close', () => {
      clearTimeout(handshakeTimer)

      if (this.activeHost === socket) {this.disconnectHost('native host disconnected')}
    })
    socket.on('error', () => {
      if (this.activeHost === socket) {this.disconnectHost('native host disconnected')}
    })
  }

  private validHello(envelope: Envelope): boolean {
    return envelope.version === this.config.version &&
      envelope.origin === this.config.origin &&
      tokensEqual(envelope.token, this.config.token)
  }

  private handleHostEnvelope(envelope: Envelope): void {
    if (envelope.type === 'event' && isObject(envelope.event)) {return}

    if (envelope.type !== 'response' || typeof envelope.id !== 'string') {
      throw new BridgeBrokerError('INVALID_ENVELOPE', 'host sent an invalid response envelope')
    }

    const pending = this.pending.get(envelope.id)

    if (pending === undefined) {
      throw new BridgeBrokerError('INVALID_ENVELOPE', 'host response has an unknown request ID')
    }

    const invalidResponse = !(
      (isObject(envelope.error) && typeof envelope.error.message === 'string') ||
      'result' in envelope
    )

    if (invalidResponse) {
      const error = new BridgeBrokerError(
        'INVALID_ENVELOPE',
        'host response has no result or error'
      )

      this.pending.delete(envelope.id)
      clearTimeout(pending.timer)
      pending.reject(error)
      throw error
    }

    this.pending.delete(envelope.id)
    clearTimeout(pending.timer)

    if (isObject(envelope.error) && typeof envelope.error.message === 'string') {
      pending.reject(new BridgeBrokerError(
        typeof envelope.error.code === 'string' ? envelope.error.code : 'BRIDGE_ERROR',
        envelope.error.message
      ))
    } else {
      pending.resolve(envelope.result)
    }
  }

  private disconnectHost(reason: string): void {
    const host = this.activeHost
    this.activeHost = undefined

    if (host !== undefined && !host.destroyed) {host.destroy()}

    if (this.connectedAt !== undefined) {this.disconnectedAt = new Date().toISOString()}

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new BridgeBrokerError('BRIDGE_DISCONNECTED', reason))
      this.pending.delete(id)
    }
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
