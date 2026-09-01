import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { type BrokerConfig, ChromeBridgeBroker } from './broker.js'

const cleanups: Array<() => Promise<void>> = []

const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'

async function setupBroker(overrides: Partial<BrokerConfig> = {}): Promise<{
  broker: ChromeBridgeBroker
  config: BrokerConfig
}> {
  const directory = await mkdtemp(join(tmpdir(), 'hermes-bridge-broker-'))

  const config: BrokerConfig = {
    origin,
    requestTimeoutMs: 100,
    socketPath: join(directory, 'broker.sock'),
    token: 'a'.repeat(64),
    version: 1,
    ...overrides
  }

  const broker = new ChromeBridgeBroker(config)
  await broker.start()
  cleanups.push(async () => {
    await broker.close()
    await rm(directory, { force: true, recursive: true })
  })

  return { broker, config }
}

function connectHost(config: BrokerConfig, hello: Record<string, unknown> = {}): Promise<{
  nextMessage: () => Promise<Record<string, unknown>>
  send: (message: Record<string, unknown>) => void
  socket: Socket
}> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(config.socketPath)
    const messages: Record<string, unknown>[] = []
    const waiters: Array<(message: Record<string, unknown>) => void> = []
    let buffered = ''

    const nextMessage = async (): Promise<Record<string, unknown>> => {
      const message = messages.shift()

      if (message !== undefined) {return message}

      return new Promise(nextResolve => waiters.push(nextResolve))
    }

    const send = (message: Record<string, unknown>): void => {
      socket.write(`${JSON.stringify(message)}\n`)
    }

    socket.once('error', reject)
    socket.on('data', chunk => {
      buffered += chunk.toString('utf8')

      for (;;) {
        const newline = buffered.indexOf('\n')

        if (newline === -1) {break}
        const message = JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>
        buffered = buffered.slice(newline + 1)
        const waiter = waiters.shift()

        if (waiter === undefined) {messages.push(message)}
        else {waiter(message)}
      }
    })
    socket.once('connect', () => {
      send({
        origin: config.origin,
        token: config.token,
        type: 'hello',
        version: config.version,
        ...hello
      })
      resolve({ nextMessage, send, socket })
    })
  })
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(async cleanup => cleanup()))
})

describe('authenticated local Chrome bridge broker', () => {
  it('rejects invalid authentication, origin, and protocol version', async () => {
    for (const badHello of [
      { token: 'bad' },
      { origin: `${origin}unexpected` },
      { version: 2 }
    ]) {
      const { broker, config } = await setupBroker()
      const host = await connectHost(config, badHello)
      expect(await host.nextMessage()).toMatchObject({ code: 'AUTH_REJECTED', type: 'error' })
      host.socket.destroy()
      expect(broker.status().connected).toBe(false)
      await cleanups.pop()?.()
    }
  })

  it('performs a real request roundtrip with request IDs', async () => {
    const { broker, config } = await setupBroker()
    const host = await connectHost(config)
    expect(await host.nextMessage()).toEqual({ type: 'hello.ok', version: 1 })

    const routed = broker.route({ arguments: {}, method: 'tabs' })
    const request = await host.nextMessage()
    expect(request).toMatchObject({ arguments: {}, method: 'tabs', type: 'request' })
    expect(request.id).toEqual(expect.any(String))
    host.send({ id: request.id, result: [{ id: 7 }], type: 'response' })

    await expect(routed).resolves.toEqual([{ id: 7 }])
    expect(broker.status()).toMatchObject({ connected: true, version: 1 })
    host.socket.destroy()
  })

  it('returns deterministic disconnected and timeout errors', async () => {
    const { broker, config } = await setupBroker()
    await expect(broker.route({ arguments: {}, method: 'snapshot' })).rejects.toMatchObject({
      code: 'BRIDGE_DISCONNECTED'
    })

    const host = await connectHost(config)
    await host.nextMessage()
    await expect(broker.route({ arguments: {}, method: 'snapshot' })).rejects.toMatchObject({
      code: 'BRIDGE_TIMEOUT'
    })
    host.socket.destroy()
  })

  it('allows only one active authenticated host and rejects malformed envelopes', async () => {
    const { broker, config } = await setupBroker()
    const first = await connectHost(config)
    await first.nextMessage()
    const second = await connectHost(config)
    expect(await second.nextMessage()).toMatchObject({ code: 'HOST_ALREADY_CONNECTED' })

    first.send({ type: 'response' })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(broker.status().connected).toBe(false)
    first.socket.destroy()
    second.socket.destroy()
  })
})
