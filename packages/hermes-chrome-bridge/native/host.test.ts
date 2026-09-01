import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { ChromeBridgeBroker } from '../src/broker.js'
import { type RuntimeConfig, writePrivateJson } from '../src/runtime.js'

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

async function waitFor<T>(read: () => T | undefined, timeoutMs = 1_000): Promise<T> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const value = read()

    if (value !== undefined) {return value}

    if (Date.now() >= deadline) {throw new Error('timed out waiting for test condition')}
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function setup(): Promise<{
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

  const broker = new ChromeBridgeBroker({ ...config, requestTimeoutMs: 200 })
  brokers.push(broker)
  await broker.start()

  const input = new PassThrough()
  const output = new PassThrough()
  const decoder = new NativeMessageDecoder(HOST_TO_BROWSER_MAX_BYTES)
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

    const status = JSON.parse(await readFile((host.config).statusPath, 'utf8')) as Record<string, unknown>
    expect(status).toMatchObject({ connected: true, version: 1 })
    expect(status).not.toHaveProperty('token')
    expect(status).not.toHaveProperty('origin')
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
