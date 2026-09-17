import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { ChromeBridgeBroker, connectBrokerClient } from '../src/broker.js'
import { ensurePrivateRuntimeDirectory, readBrokerClientConfig, type RuntimeConfig, writePrivateJson } from '../src/runtime.js'

import { FakeChromeProcess } from './fake-chrome.js'
import {
  BROWSER_TO_HOST_MAX_BYTES,
  encodeNativeMessage,
  HOST_TO_BROWSER_MAX_BYTES,
  NativeMessageDecoder
} from './framing.js'
import { authorizeChromeOrigin, NativeMessagingHost } from './host.js'
import { PROTOCOL_VERSION } from './manifest.js'

const temporaryDirectories: string[] = []
const hosts: NativeMessagingHost[] = []
const fakeChromes: FakeChromeProcess[] = []
const brokers: ChromeBridgeBroker[] = []

const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'

async function waitFor<T>(read: () => Promise<T | undefined> | T | undefined, timeoutMs = 1_000): Promise<T> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const value = await read()

    if (value !== undefined) {return value}

    if (Date.now() >= deadline) {throw new Error('timed out waiting for test condition')}
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function setup(identify = true): Promise<{
  broker: ChromeBridgeBroker
  config: RuntimeConfig
  configPath: string
  input: PassThrough
  messages: Array<Record<string, unknown>>
  output: PassThrough
}> {
  const directory = await mkdtemp(join(tmpdir(), 'hermes-native-host-'))
  temporaryDirectories.push(directory)

  const config: RuntimeConfig = {
    origin,
    socketPath: join(directory, 'broker.sock'),
    statusPath: join(directory, 'status.json'),
    token: 'b'.repeat(64),
    version: PROTOCOL_VERSION
  }

  const configPath = join(directory, 'config.json')
  await writePrivateJson(configPath, config)
  await writePrivateJson(config.statusPath, {
    connected: false,
    updatedAt: new Date().toISOString(),
    version: 1
  })

  const broker = new ChromeBridgeBroker({ ...config, requestTimeoutMs: 2_000 })
  brokers.push(broker)
  await broker.start()

  const input = new PassThrough()
  const output = new PassThrough()
  const decoder = new NativeMessageDecoder(HOST_TO_BROWSER_MAX_BYTES)

  if (identify) {
    input.write(encodeNativeMessage({ type: 'bridge.identity', version: 1,
      connectionId: '11111111-1111-4111-8111-111111111111', label: 'Test profile' }, BROWSER_TO_HOST_MAX_BYTES))
  }

  const messages: Array<Record<string, unknown>> = []
  output.on('data', chunk => {
    messages.push(...decoder.push(Buffer.from(chunk)) as Array<Record<string, unknown>>)
  })

  return { broker, config, configPath, input, messages, output }
}

afterEach(async () => {
  await Promise.all(fakeChromes.splice(0).map(async chrome => chrome.close()))
  await Promise.all(hosts.splice(0).map(async host => host.stop()))
  await Promise.all(brokers.splice(0).map(async broker => broker.close()))
  await Promise.all(temporaryDirectories.splice(0).map(async directory => {
    await rm(directory, { force: true, recursive: true })
  }))
})

describe('native messaging host', () => {
  it('runs two explicit temporary-home clients through real native stdio and forwards cancellation', async () => {
    const root = await mkdtemp('/tmp/hcb-shared-')
    temporaryDirectories.push(root)
    const config: RuntimeConfig = { origin, socketPath: join(root, 'broker.sock'), statusPath: join(root, 'status.json'), token: 'b'.repeat(64), version: 1, clientTokens: { first: 'c'.repeat(64), second: 'd'.repeat(64) } }
    const configPath = join(root, 'config.json')
    await writePrivateJson(configPath, config)
    const broker = new ChromeBridgeBroker(config)
    brokers.push(broker)
    await broker.start()

    const clients = await Promise.all(['first', 'second'].map(async clientId => {
      const home = join(root, clientId, 'chrome-bridge')
      await ensurePrivateRuntimeDirectory(home)
      const path = join(home, 'broker-client.json')
      await writePrivateJson(path, { clientId, token: config.clientTokens![clientId], socketPath: config.socketPath, version: 1 })

      return connectBrokerClient(await readBrokerClientConfig(path))
    }))

    const chrome = new FakeChromeProcess({ configPath, hostPath: join(process.cwd(), 'dist/native/host.js'), origin })
    fakeChromes.push(chrome)

    try {
      expect(await chrome.receive()).toMatchObject({ type: 'bridge.ready' })
      const controller = new AbortController()
      const first = clients[0].route({ method: 'tabs', arguments: {} }, controller.signal)
      const second = clients[1].route({ method: 'tabs', arguments: {} })
      const requests = [await chrome.receive(), await chrome.receive()] as Array<Record<string, unknown>>
      expect(requests[0].controllerId).not.toBe(requests[1].controllerId)
      const rejected = expect(first).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
      controller.abort()
      await rejected
      expect(await chrome.receive()).toMatchObject({ type: 'cancel', id: requests[0].id, controllerId: requests[0].controllerId })
      chrome.send({ type: 'response', id: requests[0].id, result: 'late' })
      chrome.send({ type: 'response', id: requests[1].id, result: 'second' })
      await expect(second).resolves.toBe('second')
      const pending = clients[1].route({ method: 'tabs', arguments: {} })
      await chrome.receive()
      const disconnected = expect(pending).rejects.toMatchObject({ code: 'BRIDGE_DISCONNECTED' })
      await broker.close()
      await disconnected
    } finally { await Promise.all(clients.map(client => client.close())) }
  })

  it('closes the native channel on invalid identity rather than leaving Chrome connecting', async () => {
    const { broker, configPath, input, output } = await setup(false)
    input.write(encodeNativeMessage({ type: 'bridge.identity', version: 1,
      connectionId: 'not-an-identity', label: 'Test' }, BROWSER_TO_HOST_MAX_BYTES))
    const host = new NativeMessagingHost({ chromeOrigin: origin, configPath, input, output, diagnostics: () => undefined })
    hosts.push(host)
    await host.start()
    expect(output.writableEnded).toBe(true)
    expect(broker.status().connectionCount).toBe(0)
  })

  it('accepts only the configured Chrome argv origin', () => {
    expect(authorizeChromeOrigin(origin, origin)).toBe(origin)
    expect(authorizeChromeOrigin(origin.slice(0, -1), origin)).toBe(origin)
    expect(() => authorizeChromeOrigin(`${origin}evil`, origin)).toThrow('unauthorized Chrome extension origin')
    expect(() => authorizeChromeOrigin(
      'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/',
      origin
    )).toThrow('unauthorized Chrome extension origin')
  })

  it('authenticates, forwards a real request roundtrip, and keeps stdout framed', async () => {
    const { broker, configPath, input, messages, output } = await setup()
    const diagnostics: string[] = []

    const host = new NativeMessagingHost({
      chromeOrigin: origin,
      configPath,
      diagnostics: message => diagnostics.push(message),
      input,
      output,
      reconnectDelayMs: 10
    })

    hosts.push(host)
    await host.start()

    expect(await waitFor(() => messages.shift())).toEqual({
      connected: true,
      type: 'bridge.ready',
      version: 1
    })

    const routed = broker.route({ arguments: {}, method: 'tabs' })
    const request = await waitFor(() => messages.shift())
    expect(request).toMatchObject({ method: 'tabs', type: 'request' })
    input.write(encodeNativeMessage({
      id: request.id,
      result: [{ id: 9 }],
      type: 'response'
    }, BROWSER_TO_HOST_MAX_BYTES))
    await expect(routed).resolves.toEqual([{ id: 9 }])
    expect(diagnostics).toEqual([])

    const status = await waitFor(async () => {
      const current = JSON.parse(await readFile((host.config).statusPath, 'utf8')) as Record<string, unknown>

      return current.connected === true ? current : undefined
    })

    expect(status).toMatchObject({ connected: true, version: 1 })
    expect(status).not.toHaveProperty('token')
    expect(status).not.toHaveProperty('origin')
    output.end()
  })

  it('supports browser responses larger than the host-to-browser request limit', async () => {
    const { broker, configPath, input, messages, output } = await setup()
    const diagnostics: string[] = []

    const host = new NativeMessagingHost({
      chromeOrigin: origin,
      configPath,
      diagnostics: message => diagnostics.push(message),
      input,
      output
    })

    hosts.push(host)
    await host.start()
    await waitFor(() => messages.shift())

    const routed = broker.route({ arguments: {}, method: 'snapshot' })
    const request = await waitFor(() => messages.shift())
    const screenshot = 'x'.repeat(2 * 1024 * 1024)
    input.write(encodeNativeMessage({
      id: request.id,
      result: { screenshot },
      type: 'response'
    }, BROWSER_TO_HOST_MAX_BYTES))

    await expect(routed).resolves.toMatchObject({ screenshot })
    expect(diagnostics).toEqual([])
    output.end()
  })

  it('supports a fake-Chrome child process roundtrip against the built native host', async () => {
    const { broker, configPath } = await setup()

    const chrome = new FakeChromeProcess({
      configPath,
      hostPath: join(process.cwd(), 'dist', 'native', 'host.js'),
      origin
    })

    fakeChromes.push(chrome)

    await expect(Promise.race([
      chrome.receive(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('host startup timeout')), 1_000))
    ])).resolves.toEqual({ connected: true, type: 'bridge.ready', version: 1 })

    const routed = broker.route({ arguments: {}, method: 'tabs' })
    const request = await chrome.receive() as Record<string, unknown>
    chrome.send({ id: request.id, result: [{ id: 12 }], type: 'response' })
    await expect(routed).resolves.toEqual([{ id: 12 }])
  })

  it('serializes rapid connectivity status updates and persists final disconnection', async () => {
    const { broker, config, configPath } = await setup()
    const diagnostics: string[] = []

    for (let iteration = 0; iteration < 20; iteration += 1) {
      const input = new PassThrough()
      const output = new PassThrough()
      input.write(encodeNativeMessage({ type: 'bridge.identity', version: 1,
        connectionId: '11111111-1111-4111-8111-111111111111', label: 'Test profile' }, BROWSER_TO_HOST_MAX_BYTES))

      const host = new NativeMessagingHost({
        chromeOrigin: origin,
        configPath,
        diagnostics: message => diagnostics.push(message),
        input,
        output,
        reconnectDelayMs: 1_000
      })

      hosts.push(host)
      await host.start()
      await host.stop()
      await waitFor(() => broker.status().connected ? undefined : true)
      output.end()
    }

    await waitFor(async () => JSON.parse(await readFile(config.statusPath, 'utf8')).connected === false ? true : undefined)
    const text = await readFile(config.statusPath, 'utf8')
    expect(() => JSON.parse(text)).not.toThrow()
    expect(JSON.parse(text)).toMatchObject({ connected: false, version: 1 })
    expect(diagnostics).toEqual([])
  })

  it('preserves public browser identities across simultaneous native hosts', async () => {
    const { broker, config, configPath, input, output } = await setup(false)
    const secondInput = new PassThrough()

    const identify = (stream: PassThrough, connectionId: string, label: string): void => {
      stream.write(encodeNativeMessage({ type: 'bridge.identity', version: 1, connectionId, label }, BROWSER_TO_HOST_MAX_BYTES))
    }

    identify(input, '11111111-1111-4111-8111-111111111111', 'First profile')
    identify(secondInput, '22222222-2222-4222-8222-222222222222', 'Second profile')
    const first = new NativeMessagingHost({ chromeOrigin: origin, configPath, input, output })
    const second = new NativeMessagingHost({ chromeOrigin: origin, configPath, input: secondInput, output: new PassThrough() })
    hosts.push(first, second)
    await Promise.all([first.start(), second.start()])
    expect(broker.status()).toMatchObject({ connectionCount: 2, connections: [
      { connectionId: '11111111-1111-4111-8111-111111111111', label: 'First profile' },
      { connectionId: '22222222-2222-4222-8222-222222222222', label: 'Second profile' }
    ] })
    await first.stop()
    await expect.poll(() => broker.status().connectionCount).toBe(1)
    await expect.poll(async () => JSON.parse(await readFile(config.statusPath, 'utf8')))
      .toMatchObject({ connected: true, connectionCount: 1 })
    await second.stop()
    await expect.poll(async () => JSON.parse(await readFile(config.statusPath, 'utf8')))
      .toMatchObject({ connected: false, connectionCount: 0 })
  })

  it('emits bounded disconnected state and reconnects while the Chrome port is alive', async () => {
    const { broker, configPath, input, messages, output } = await setup()

    const host = new NativeMessagingHost({
      chromeOrigin: origin,
      configPath,
      diagnostics: () => undefined,
      input,
      output,
      reconnectDelayMs: 10
    })

    hosts.push(host)
    await host.start()
    await waitFor(() => messages.shift())

    await broker.close()
    brokers.splice(brokers.indexOf(broker), 1)
    expect(await waitFor(() => messages.shift())).toEqual({
      connected: false,
      type: 'bridge.disconnected',
      version: 1
    })

    const replacement = new ChromeBridgeBroker(host.config)
    brokers.push(replacement)
    await replacement.start()
    expect(await waitFor(() => messages.shift())).toEqual({
      connected: true,
      type: 'bridge.ready',
      version: 1
    })
    input.end()
    output.end()
  })
})
