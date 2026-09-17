import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { type BrokerConfig, ChromeBridgeBroker, connectBrokerClient } from './broker.js'

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
  it('attaches explicitly enrolled clients without replacing the host or leaking parallel responses', async () => {
    const clientToken = 'c'.repeat(64)
    const { broker, config } = await setupBroker({ clientTokens: { enrolled: clientToken } })
    await expect(connectBrokerClient({ socketPath: config.socketPath, clientId: 'enrolled', token: config.token, version: 1 })).rejects.toMatchObject({ code: 'AUTH_REJECTED' })
    const host = await connectHost(config)
    await host.nextMessage()
    const clients = await Promise.all([0, 1].map(() => connectBrokerClient({ socketPath: config.socketPath, clientId: 'enrolled', token: clientToken, version: 1 })))

    try {
      const pending = clients.map(client => client.route({ method: 'tabs', arguments: {} }))
      const requests = [await host.nextMessage(), await host.nextMessage()]
      expect(requests[0].id).not.toBe(requests[1].id)
      host.send({ type: 'response', id: requests[1].id, result: 'second' })
      host.send({ type: 'response', id: requests[0].id, result: 'first' })
      await expect(Promise.all(pending)).resolves.toEqual(['first', 'second'])
      expect(broker.status().connectionCount).toBe(1)
    } finally { await Promise.all(clients.map(client => client.close())); host.socket.destroy() }
  })

  it('cancels only its own pending request and tolerates late native replies', async () => {
    const { broker, config } = await setupBroker({ clientTokens: { enrolled: 'c'.repeat(64) }, maxPending: 1, requestTimeoutMs: 2_000 })
    const host = await connectHost(config)
    await host.nextMessage()
    const client = await connectBrokerClient({ socketPath: config.socketPath, clientId: 'enrolled', token: 'c'.repeat(64), version: 1 })

    try {
      const controller = new AbortController()
      const result = client.route({ method: 'tabs', arguments: {} }, controller.signal)
      const cancelled = await host.nextMessage()
      const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
      controller.abort()
      await rejection
      expect(await host.nextMessage()).toMatchObject({ type: 'cancel', id: cancelled.id })
      const next = client.route({ method: 'tabs', arguments: {} })
      const request = await host.nextMessage()
      host.send({ type: 'response', id: cancelled.id, result: 'late' })
      host.send({ type: 'response', id: request.id, result: 'current' })
      await expect(next).resolves.toBe('current')
      expect(broker.status().connected).toBe(true)
    } finally { await client.close(); host.socket.destroy() }
  })

  it('releases native pending slots on client disconnect and rejects on owner shutdown', async () => {
    const { broker, config } = await setupBroker({ clientTokens: { enrolled: 'c'.repeat(64) }, maxPending: 1, requestTimeoutMs: 2_000 })
    const host = await connectHost(config)
    await host.nextMessage()
    const connect = async () => connectBrokerClient({ socketPath: config.socketPath, clientId: 'enrolled', token: 'c'.repeat(64), version: 1 })
    const client = await connect()
    const result = client.route({ method: 'tabs', arguments: {} })
    await host.nextMessage()
    const rejected = expect(result).rejects.toMatchObject({ code: 'BRIDGE_DISCONNECTED' })
    await client.close()
    await rejected
    const other = await connect()
    expect(await host.nextMessage()).toMatchObject({ type: 'cancel' })
    const next = other.route({ method: 'tabs', arguments: {} })
    await host.nextMessage()
    const ownerRejected = expect(next).rejects.toMatchObject({ code: 'BRIDGE_DISCONNECTED' })
    await broker.close()
    await ownerRejected
    await other.close()
  })

  it('assigns unspoofable controller identities and leases mutation tabs until release or disconnect', async () => {
    const { config } = await setupBroker({ clientTokens: { enrolled: 'c'.repeat(64) } })
    const host = await connectHost(config)
    await host.nextMessage()
    const connect = async () => connectBrokerClient({ socketPath: config.socketPath, clientId: 'enrolled', token: 'c'.repeat(64), version: 1 })
    const first = await connect(), second = await connect()

    try {
      const listing = first.route({ method: 'tabs', arguments: {} })
      const list = await host.nextMessage()
      host.send({ type: 'response', id: list.id, result: { tabId: 7 } })
      const { tabId } = await listing as { tabId: string }
      const click = first.route({ method: 'click', arguments: { tabId }, controllerId: 'spoofed' } as Parameters<typeof first.route>[0])
      const request = await host.nextMessage()
      expect(request.controllerId).toEqual(expect.any(String))
      expect(request.controllerId).not.toBe('spoofed')
      expect(request.arguments).not.toHaveProperty('controllerId')
      host.send({ type: 'response', id: request.id, result: true })
      await click

      for (const method of ['click', 'drag']) {
        await expect(second.route({ method: method as Parameters<typeof second.route>[0]['method'], arguments: { tabId } })).rejects.toMatchObject({ code: 'TAB_BUSY' })
      }

      await first.releaseControl(tabId)
      const next = second.route({ method: 'click', arguments: { tabId } })
      const nextRequest = await host.nextMessage()
      expect(nextRequest.controllerId).not.toBe(request.controllerId)
      host.send({ type: 'response', id: nextRequest.id, result: true })
      await next
      await second.close()
      // An acknowledged read after reconnect ensures the disconnect was processed.
      const barrier = await connect()
      await barrier.close()
      const resumed = first.route({ method: 'click', arguments: { tabId } })
      const resumedRequest = await host.nextMessage()
      host.send({ type: 'response', id: resumedRequest.id, result: true })
      await resumed
    } finally { await first.close(); await second.close(); host.socket.destroy() }
  })

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

  it('settles a pending request when its response has no result or error', async () => {
    const { broker, config } = await setupBroker({ requestTimeoutMs: 1_000 })
    const host = await connectHost(config)
    await host.nextMessage()

    const routed = broker.route({ arguments: {}, method: 'snapshot' })
    const request = await host.nextMessage()
    host.send({ id: request.id, type: 'response' })

    const outcome = await Promise.race([
      routed.then(
        () => ({ state: 'resolved' }),
        (error: unknown) => ({ error, state: 'rejected' })
      ),
      new Promise(resolve => setTimeout(() => resolve({ state: 'still-pending' }), 50))
    ])

    expect(outcome).toMatchObject({
      error: { code: 'INVALID_ENVELOPE' },
      state: 'rejected'
    })
    host.socket.destroy()
  })

  it('parses concatenated valid response frames before enforcing the residual limit', async () => {
    const { broker, config } = await setupBroker({ requestTimeoutMs: 2_000 })
    const host = await connectHost(config)
    await host.nextMessage()

    const firstRouted = broker.route({ arguments: {}, method: 'snapshot' })
    const secondRouted = broker.route({ arguments: {}, method: 'snapshot' })
    const firstRequest = await host.nextMessage()
    const secondRequest = await host.nextMessage()
    const result = 'x'.repeat(33 * 1024 * 1024)

    const combined = Buffer.from(
      `${JSON.stringify({ id: firstRequest.id, result, type: 'response' })}\n` +
      `${JSON.stringify({ id: secondRequest.id, result, type: 'response' })}\n`
    )

    // Exercise one concatenated parser delivery, not OS-dependent fragmentation
    // of a 64 MiB socket write (which needlessly makes this a performance test).
    const connections = (broker as unknown as { hosts: Map<string, { socket: Socket }> }).hosts
    connections.values().next().value!.socket.emit('data', combined)

    await expect(Promise.all([firstRouted, secondRouted])).resolves.toEqual([result, result])
    host.socket.destroy()
  }, 10_000)

  it('namespaces overlapping tabs, concurrent requests and selected-tab state per connection', async () => {
    const { broker, config } = await setupBroker({ requestTimeoutMs: 2_000 })
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
    const hosts = await Promise.all(ids.map(connectionId => connectHost(config, { connectionId, label: 'Same label' })))
    await Promise.all(hosts.map(host => host.nextMessage()))
    const listing = ids.map(connectionId => broker.route({ arguments: { connectionId }, method: 'tabs' }))
    const requests = await Promise.all(hosts.map(host => host.nextMessage()))
    expect(requests[0].id).not.toBe(requests[1].id)

    // Complete out of order; both Chrome profiles use native tab ID 7.
    for (const index of [1, 0]) {
      hosts[index].send({ id: requests[index].id, type: 'response', result: { selectedTabId: 7, tabs: [{ tabId: 7 }] } })
    }

    const results = await Promise.all(listing) as Array<{ selectedTabId: string, tabs: Array<{ tabId: string }> }>
    expect(results[0].selectedTabId).not.toBe(results[1].selectedTabId)

    for (const [index, result] of results.entries()) {
      expect(result.tabs[0].tabId).toBe(result.selectedTabId)
      const selected = broker.route({ arguments: { tabId: result.selectedTabId }, method: 'selectTab' })
      const request = await hosts[index].nextMessage()
      expect(request.arguments).toEqual({ tabId: 7 })
      hosts[index].send({ id: request.id, type: 'response', result: { selectedTabId: 7 } })
      await expect(selected).resolves.toMatchObject({ selectedTabId: result.selectedTabId, connectionId: ids[index] })
    }

    await expect(broker.route({ method: 'close', arguments: { connectionId: ids[1], tabId: results[0].selectedTabId } }))
      .rejects.toMatchObject({ code: 'CONNECTION_MISMATCH' })
    await expect(broker.route({ method: 'close', arguments: { tabId: 7 } }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_CONNECTION' })
  })

  it('isolates disconnect, reconnect, pending limits and stale tab capabilities', async () => {
    const { broker, config } = await setupBroker({ maxPending: 1, requestTimeoutMs: 2_000 })
    const a = '11111111-1111-4111-8111-111111111111'
    const b = '22222222-2222-4222-8222-222222222222'
    const first = await connectHost(config, { connectionId: a })
    const second = await connectHost(config, { connectionId: b })
    await Promise.all([first.nextMessage(), second.nextMessage()])
    const oldSession = broker.status().connections.find(connection => connection.connectionId === a)!.sessionId
    const pendingA = broker.route({ method: 'query', arguments: { connectionId: a, tabId: 7 } })
    const rejectedA = expect(pendingA).rejects.toMatchObject({ code: 'BRIDGE_DISCONNECTED' })
    const requestA = await first.nextMessage()
    await expect(broker.route({ method: 'tabs', arguments: { connectionId: a } })).rejects.toMatchObject({ code: 'BRIDGE_BUSY' })
    const pendingB = broker.route({ method: 'tabs', arguments: { connectionId: b } })
    const requestB = await second.nextMessage()
    first.socket.destroy()
    await rejectedA
    second.send({ id: requestB.id, type: 'response', result: { tabs: [{ tabId: 7 }] } })
    await expect(pendingB).resolves.toMatchObject({ connectionId: b })
    const replacement = await connectHost(config, { connectionId: a })
    await replacement.nextMessage()
    expect(broker.status().connections.find(connection => connection.connectionId === a)!.sessionId).not.toBe(oldSession)
    await expect(broker.route({ method: 'close', arguments: { tabId: `${a}:${oldSession}:7` } }))
      .rejects.toMatchObject({ code: 'STALE_TAB_ID' })
    // A stale response cannot fulfill another profile's current request.
    const currentB = broker.route({ method: 'tabs', arguments: { connectionId: b } })
    const currentRequestB = await second.nextMessage()
    replacement.send({ id: currentRequestB.id, type: 'response', result: { wrong: true } })
    await expect.poll(() => broker.status().connectionCount).toBe(1)
    expect(currentRequestB.id).not.toBe(requestA.id)
    second.send({ id: currentRequestB.id, type: 'response', result: { correct: true } })
    await expect(currentB).resolves.toMatchObject({ correct: true, connectionId: b })
    await expect(broker.route({ method: 'open', arguments: {} })).rejects.toMatchObject({ code: 'AMBIGUOUS_CONNECTION' })
  })

  it('does not silently switch the single-profile default after discovery alone', async () => {
    const { broker, config } = await setupBroker()
    const first = await connectHost(config)
    await first.nextMessage()
    const discovered = await broker.route({ method: 'status', arguments: {} })
    expect(discovered).toMatchObject({ connectionCount: 1 })
    first.socket.destroy()
    await expect.poll(() => broker.status().connectionCount).toBe(0)
    const replacement = await connectHost(config)
    await replacement.nextMessage()
    await expect(broker.route({ method: 'open', arguments: {} }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_CONNECTION' })
  })

  it('never reuses request IDs across broker restarts', async () => {
    const requestIds = []

    for (let index = 0; index < 2; index++) {
      const { broker, config } = await setupBroker({ requestTimeoutMs: 2_000 })
      const host = await connectHost(config)
      await host.nextMessage()
      const routed = broker.route({ method: 'tabs', arguments: {} })
      const request = await host.nextMessage()
      requestIds.push(request.id)
      host.send({ id: request.id, type: 'response', result: {} })
      await routed
      host.socket.destroy()
    }

    expect(requestIds[0]).not.toBe(requestIds[1])
  })

  it('rejects duplicate identities without replacing their active host', async () => {
    const { broker, config } = await setupBroker()
    const connectionId = '11111111-1111-4111-8111-111111111111'
    const first = await connectHost(config, { connectionId, label: 'Work' })
    await first.nextMessage()
    const duplicate = await connectHost(config, { connectionId, label: 'Other' })
    expect(await duplicate.nextMessage()).toMatchObject({ code: 'CONNECTION_ALREADY_CONNECTED' })
    expect(broker.status()).toMatchObject({ connectionCount: 1, connections: [{ label: 'Work' }] })
    duplicate.socket.destroy()
  })

  it('isolates authenticated profiles and fails closed on ambiguous commands', async () => {
    const { broker, config } = await setupBroker()
    const first = await connectHost(config, { connectionId: '11111111-1111-4111-8111-111111111111', label: 'Work' })
    await first.nextMessage()
    const second = await connectHost(config, { connectionId: '22222222-2222-4222-8222-222222222222', label: 'Personal' })
    expect(await second.nextMessage()).toMatchObject({ type: 'hello.ok' })
    await expect(broker.route({ arguments: {}, method: 'open' })).rejects.toMatchObject({ code: 'AMBIGUOUS_CONNECTION' })

    first.send({ type: 'response' })
    await expect.poll(() => broker.status()).toMatchObject({
      connected: true,
      connections: [{ connectionId: '22222222-2222-4222-8222-222222222222', label: 'Personal' }]
    })
    first.socket.destroy()
    second.socket.destroy()
  })
})
