#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import {
  readRuntimeConfig,
  type RuntimeConfig,
  writeRuntimeStatus
} from '../src/runtime.js'

import {
  BROWSER_TO_HOST_MAX_BYTES,
  encodeNativeMessage,
  HOST_TO_BROWSER_MAX_BYTES,
  NativeMessageDecoder
} from './framing.js'
import { normalizeExtensionOrigin, PROTOCOL_VERSION } from './manifest.js'

const IPC_MAX_BYTES = 1024 * 1024

export interface NativeMessagingHostOptions {
  chromeOrigin: string
  configPath: string
  diagnostics?: (message: string) => void
  input?: Readable
  output?: Writable
  reconnectDelayMs?: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function authorizeChromeOrigin(actualOrigin: string, configuredOrigin: string): string {
  let normalized: string

  try {
    normalized = normalizeExtensionOrigin(actualOrigin)
  } catch {
    throw new Error('unauthorized Chrome extension origin')
  }

  if (normalized !== normalizeExtensionOrigin(configuredOrigin)) {
    throw new Error('unauthorized Chrome extension origin')
  }

  return normalized
}

export class NativeMessagingHost {
  public config!: RuntimeConfig

  private readonly decoder = new NativeMessageDecoder(BROWSER_TO_HOST_MAX_BYTES)
  private readonly diagnostics: (message: string) => void
  private readonly input: Readable
  private readonly output: Writable
  private readonly reconnectDelayMs: number
  private broker?: Socket
  private brokerBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private connected = false
  private reconnectTimer?: NodeJS.Timeout
  private stopped = false

  public constructor(private readonly options: NativeMessagingHostOptions) {
    this.input = options.input ?? process.stdin
    this.output = options.output ?? process.stdout
    this.diagnostics = options.diagnostics ?? (message => process.stderr.write(`${message}\n`))
    this.reconnectDelayMs = options.reconnectDelayMs ?? 250
  }

  public async start(): Promise<void> {
    this.config = await readRuntimeConfig(this.options.configPath)
    authorizeChromeOrigin(this.options.chromeOrigin, this.config.origin)
    this.input.on('data', chunk => this.handleBrowserData(Buffer.from(chunk)))
    this.input.once('end', () => void this.stop())
    this.input.once('error', () => void this.stop())
    await this.connectOnce()
  }

  public async stop(): Promise<void> {
    if (this.stopped) {return}
    this.stopped = true

    if (this.reconnectTimer !== undefined) {clearTimeout(this.reconnectTimer)}
    this.broker?.destroy()
    this.broker = undefined
    await this.updateStatus(false)
  }

  private async connectOnce(): Promise<void> {
    if (this.stopped) {return}
    await new Promise<void>(resolveConnect => {
      const socket = createConnection(this.config.socketPath)
      this.broker = socket
      this.brokerBuffer = Buffer.alloc(0)
      let resolved = false

      const finish = (): void => {
        if (!resolved) {
          resolved = true
          resolveConnect()
        }
      }

      socket.once('connect', () => {
        this.sendBroker({
          origin: this.config.origin,
          token: this.config.token,
          type: 'hello',
          version: PROTOCOL_VERSION
        })
      })
      socket.on('data', chunk => {
        try {
          this.handleBrokerData(Buffer.from(chunk))
        } catch {
          this.diagnostics('Hermes Chrome bridge broker sent an invalid protocol message')
          socket.destroy()
        }

        if (this.connected) {finish()}
      })
      socket.once('error', () => finish())
      socket.once('close', () => {
        finish()
        const wasConnected = this.connected
        this.connected = false

        if (this.broker === socket) {this.broker = undefined}

        if (wasConnected) {
          this.writeBrowserStatus(false)
          void this.updateStatus(false)
        }

        this.scheduleReconnect()
      })
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) {return}
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connectOnce()
    }, this.reconnectDelayMs)
  }

  private handleBrokerData(chunk: Buffer): void {
    this.brokerBuffer = this.brokerBuffer.length === 0
      ? chunk
      : Buffer.concat([this.brokerBuffer, chunk])

    if (this.brokerBuffer.length > IPC_MAX_BYTES) {throw new Error('broker frame too large')}

    for (;;) {
      const newline = this.brokerBuffer.indexOf(0x0a)

      if (newline === -1) {return}
      const line = this.brokerBuffer.subarray(0, newline)
      this.brokerBuffer = this.brokerBuffer.subarray(newline + 1)

      if (line.length === 0) {continue}
      let text: string

      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(line)
      } catch {
        throw new Error('invalid broker UTF-8')
      }

      const envelope = JSON.parse(text) as unknown

      if (!isObject(envelope) || typeof envelope.type !== 'string') {
        throw new Error('invalid broker envelope')
      }

      if (envelope.type === 'hello.ok' && envelope.version === PROTOCOL_VERSION) {
        if (!this.connected) {
          this.connected = true
          this.writeBrowserStatus(true)
          void this.updateStatus(true)
        }
      } else if (
        envelope.type === 'request' &&
        typeof envelope.id === 'string' &&
        typeof envelope.method === 'string' &&
        isObject(envelope.arguments)
      ) {
        this.writeBrowser(envelope)
      } else if (envelope.type === 'error') {
        this.broker?.destroy()
      } else {
        throw new Error('invalid broker envelope')
      }
    }
  }

  private handleBrowserData(chunk: Buffer): void {
    try {
      for (const value of this.decoder.push(chunk)) {
        if (!isObject(value) || typeof value.type !== 'string') {
          throw new Error('invalid browser envelope')
        }

        if (
          value.type === 'response' &&
          typeof value.id === 'string' &&
          (('result' in value) || isObject(value.error))
        ) {
          this.sendBroker(value)
        } else if (value.type === 'event' && isObject(value.event)) {
          this.sendBroker(value)
        } else {
          throw new Error('invalid browser envelope')
        }
      }
    } catch {
      this.diagnostics('Hermes Chrome bridge received an invalid native message')
      void this.stop()
    }
  }

  private sendBroker(envelope: Record<string, unknown>): void {
    if (this.broker === undefined || this.broker.destroyed) {return}
    const bytes = Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8')

    if (bytes.length > IPC_MAX_BYTES) {throw new Error('IPC envelope exceeds size limit')}
    this.broker.write(bytes)
  }

  private writeBrowserStatus(connected: boolean): void {
    this.writeBrowser({
      connected,
      type: connected ? 'bridge.ready' : 'bridge.disconnected',
      version: PROTOCOL_VERSION
    })
  }

  private writeBrowser(envelope: Record<string, unknown>): void {
    this.output.write(encodeNativeMessage(envelope, HOST_TO_BROWSER_MAX_BYTES))
  }

  private async updateStatus(connected: boolean): Promise<void> {
    const now = new Date().toISOString()
    await writeRuntimeStatus(this.config.statusPath, {
      connected,
      ...(connected ? { connectedAt: now } : { disconnectedAt: now }),
      updatedAt: now,
      version: PROTOCOL_VERSION
    }).catch(() => {
      this.diagnostics('Hermes Chrome bridge could not update connectivity status')
    })
  }
}

function isEntrypoint(): boolean {
  if (process.argv[1] === undefined) {return false}

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (isEntrypoint()) {
  const configPath = process.argv[2]
  const chromeOrigin = process.argv[3]

  if (configPath === undefined || chromeOrigin === undefined) {
    process.stderr.write('Hermes Chrome bridge native host requires config path and Chrome origin\n')
    process.exitCode = 2
  } else {
    const host = new NativeMessagingHost({
      chromeOrigin,
      configPath: resolve(configPath)
    })

    await host.start().catch(() => {
      process.stderr.write('Hermes Chrome bridge native host failed to start\n')
      process.exitCode = 1
    })
  }
}
