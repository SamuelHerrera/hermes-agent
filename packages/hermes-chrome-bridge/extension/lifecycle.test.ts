import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createConnectionController,
  NATIVE_HOST_NAME,
  type NativePortLike
} from './lifecycle.js'

class EventChannel<T extends (...arguments_: never[]) => void> {
  readonly listeners: T[] = []

  addListener(listener: T): void {
    this.listeners.push(listener)
  }

  emit(...arguments_: Parameters<T>): void {
    for (const listener of this.listeners) { listener(...arguments_) }
  }
}

class FakePort implements NativePortLike {
  readonly onDisconnect = new EventChannel<() => void>()
  readonly onMessage = new EventChannel<(message: unknown) => void>()
  readonly sent: unknown[] = []
  disconnected = false

  disconnect(): void {
    this.disconnected = true
  }

  postMessage(message: unknown): void {
    this.sent.push(message)
  }
}

function setup(initialOptIn = false) {
  let optedIn = initialOptIn
  const ports: FakePort[] = []

  const connectNative = vi.fn((host: string) => {
    const port = new FakePort()
    ports.push(port)

    return port
  })

  const controller = createConnectionController({
    connectNative,
    readOptIn: async () => optedIn,
    writeOptIn: async value => { optedIn = value }
  })

  return { connectNative, controller, ports, readStoredOptIn: () => optedIn }
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('extension connection lifecycle', () => {
  it('does not connect on startup until the user explicitly opts in', async () => {
    const { connectNative, controller } = setup(false)

    await controller.start()

    expect(connectNative).not.toHaveBeenCalled()
    expect(controller.getState()).toEqual({
      connection: 'disconnected',
      optedIn: false,
      retry: { attempt: 0, scheduled: false }
    })
  })

  it('persists popup opt-in and connects only to the exact native host', async () => {
    const { connectNative, controller, readStoredOptIn } = setup(false)
    await controller.start()

    await controller.connect()

    expect(readStoredOptIn()).toBe(true)
    expect(connectNative).toHaveBeenCalledWith(NATIVE_HOST_NAME)
    expect(NATIVE_HOST_NAME).toBe('com.nous.hermes_chrome_bridge')
    expect(controller.getState().connection).toBe('connecting')
  })

  it('reconnects on startup only when opt-in was persisted', async () => {
    const { connectNative, controller } = setup(true)

    await controller.start()

    expect(connectNative).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ connection: 'connecting', optedIn: true })
  })

  it('transitions to connected only after a valid bridge.ready envelope', async () => {
    const { controller, ports } = setup(true)
    await controller.start()

    ports[0].onMessage.emit({ connected: true, type: 'bridge.ready', version: 1 })

    expect(controller.getState()).toEqual({
      connection: 'connected',
      optedIn: true,
      retry: { attempt: 0, scheduled: false }
    })
  })

  it('reports a safe error and applies capped exponential backoff after disconnects', async () => {
    const { connectNative, controller, ports } = setup(true)
    await controller.start()

    ports[0].onDisconnect.emit()
    expect(controller.getState()).toMatchObject({
      connection: 'error',
      lastError: {
        code: 'NATIVE_HOST_DISCONNECTED',
        message: 'The Hermes native host disconnected.'
      },
      retry: { attempt: 1, nextDelayMs: 250, scheduled: true }
    })

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await vi.advanceTimersByTimeAsync(Math.min(250 * 2 ** (attempt - 1), 8_000))
      ports.at(-1)?.onDisconnect.emit()
    }

    expect(connectNative.mock.calls.length).toBeGreaterThan(1)
    expect(controller.getState().retry.nextDelayMs).toBe(8_000)
  })

  it('handles bridge.disconnected as a retryable safe error', async () => {
    const { controller, ports } = setup(true)
    await controller.start()

    ports[0].onMessage.emit({ connected: false, type: 'bridge.disconnected', version: 1 })

    expect(controller.getState()).toMatchObject({
      connection: 'error',
      lastError: {
        code: 'BRIDGE_DISCONNECTED',
        message: 'The Hermes bridge is not ready.'
      },
      retry: { attempt: 1, nextDelayMs: 250, scheduled: true }
    })
  })

  it('rejects malformed native messages without exposing their payload', async () => {
    const { controller, ports } = setup(true)
    await controller.start()

    ports[0].onMessage.emit({ secret: 'do-not-display', type: 'bridge.ready', version: 99 })

    expect(controller.getState().lastError).toEqual({
      code: 'INVALID_NATIVE_MESSAGE',
      message: 'The native host sent an invalid message.'
    })
    expect(JSON.stringify(controller.getState())).not.toContain('do-not-display')
  })

  it('returns a structured NOT_IMPLEMENTED response for unknown requests', async () => {
    const { controller, ports } = setup(true)
    await controller.start()

    ports[0].onMessage.emit({
      arguments: {},
      id: 'request-1',
      method: 'tabs',
      type: 'request'
    })

    expect(ports[0].sent).toEqual([{
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'This bridge method is not implemented by the extension shell.'
      },
      id: 'request-1',
      type: 'response'
    }])
  })

  it('disconnect revokes opt-in, cancels retry, and closes the native port', async () => {
    const { controller, ports, readStoredOptIn } = setup(true)
    await controller.start()
    ports[0].onDisconnect.emit()

    await controller.disconnect()

    expect(readStoredOptIn()).toBe(false)
    expect(ports[0].disconnected).toBe(true)
    expect(controller.getState()).toEqual({
      connection: 'disconnected',
      optedIn: false,
      retry: { attempt: 0, scheduled: false }
    })
    await vi.runAllTimersAsync()
    expect(ports).toHaveLength(1)
  })
})
