export const NATIVE_HOST_NAME = 'com.nous.hermes_chrome_bridge'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SafeError {
  code: 'BRIDGE_DISCONNECTED' | 'INVALID_NATIVE_MESSAGE' | 'NATIVE_HOST_DISCONNECTED'
  message: string
}

export interface RetryState {
  attempt: number
  nextDelayMs?: number
  scheduled: boolean
}

export interface ConnectionState {
  connection: ConnectionStatus
  lastError?: SafeError
  optedIn: boolean
  retry: RetryState
}

interface ListenerChannel<T extends (...arguments_: never[]) => void> {
  addListener(listener: T): void
}

export interface NativePortLike {
  disconnect(): void
  onDisconnect: ListenerChannel<() => void>
  onMessage: ListenerChannel<(message: unknown) => void>
  postMessage(message: unknown): void
}

interface TimerApi {
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
}

export interface ConnectionControllerDependencies {
  connectNative(hostName: string): NativePortLike
  readOptIn(): Promise<boolean>
  timer?: TimerApi
  writeOptIn(optedIn: boolean): Promise<void>
}

export interface ConnectionController {
  connect(): Promise<void>
  disconnect(): Promise<void>
  getState(): ConnectionState
  start(): Promise<void>
  subscribe(listener: (state: ConnectionState) => void): () => void
}

const INITIAL_RETRY_DELAY_MS = 250
const MAX_RETRY_DELAY_MS = 8_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()

  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isReadyMessage(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, ['connected', 'type', 'version']) &&
    value.connected === true && value.type === 'bridge.ready' && value.version === 1
}

function isDisconnectedMessage(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, ['connected', 'type', 'version']) &&
    value.connected === false && value.type === 'bridge.disconnected' && value.version === 1
}

function isRequest(value: Record<string, unknown>): value is Record<string, unknown> & {
  arguments: Record<string, unknown>
  id: string
  method: string
  type: 'request'
} {
  return hasExactKeys(value, ['arguments', 'id', 'method', 'type']) &&
    value.type === 'request' &&
    typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.method === 'string' && value.method.length > 0 &&
    isRecord(value.arguments)
}

function copyState(state: ConnectionState): ConnectionState {
  return {
    connection: state.connection,
    ...(state.lastError === undefined ? {} : { lastError: { ...state.lastError } }),
    optedIn: state.optedIn,
    retry: { ...state.retry }
  }
}

export function createConnectionController(
  dependencies: ConnectionControllerDependencies
): ConnectionController {
  const timer = dependencies.timer ?? {
    clearTimeout: handle => clearTimeout(handle),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs)
  }

  const listeners = new Set<(state: ConnectionState) => void>()
  const ignoredDisconnects = new WeakSet<NativePortLike>()
  let port: NativePortLike | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  let state: ConnectionState = {
    connection: 'disconnected',
    optedIn: false,
    retry: { attempt: 0, scheduled: false }
  }

  const publish = (): void => {
    const snapshot = copyState(state)

    for (const listener of listeners) { listener(snapshot) }
  }

  const replaceState = (next: ConnectionState): void => {
    state = next
    publish()
  }

  const cancelRetry = (): void => {
    if (retryTimer !== undefined) {
      timer.clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }

  const closePort = (): void => {
    if (port === undefined) { return }
    const closing = port
    port = undefined
    ignoredDisconnects.add(closing)
    closing.disconnect()
  }

  const connectNow = (): void => {
    if (!state.optedIn) { return }
    cancelRetry()
    closePort()
    replaceState({
      connection: 'connecting',
      optedIn: true,
      retry: { attempt: state.retry.attempt, scheduled: false }
    })

    let nextPort: NativePortLike

    try {
      nextPort = dependencies.connectNative(NATIVE_HOST_NAME)
    } catch {
      scheduleError({
        code: 'NATIVE_HOST_DISCONNECTED',
        message: 'The Hermes native host disconnected.'
      })

      return
    }

    port = nextPort
    nextPort.onMessage.addListener(message => {
      if (port !== nextPort) { return }
      handleNativeMessage(nextPort, message)
    })
    nextPort.onDisconnect.addListener(() => {
      if (ignoredDisconnects.delete(nextPort) || port !== nextPort || !state.optedIn) { return }
      scheduleError({
        code: 'NATIVE_HOST_DISCONNECTED',
        message: 'The Hermes native host disconnected.'
      })
    })
  }

  const scheduleError = (error: SafeError): void => {
    if (!state.optedIn) { return }
    cancelRetry()
    const attempt = state.retry.attempt + 1
    const nextDelayMs = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)
    retryTimer = timer.setTimeout(() => {
      retryTimer = undefined
      connectNow()
    }, nextDelayMs)
    replaceState({
      connection: 'error',
      lastError: error,
      optedIn: true,
      retry: { attempt, nextDelayMs, scheduled: true }
    })
  }

  const rejectInvalidMessage = (nativePort: NativePortLike): void => {
    scheduleError({
      code: 'INVALID_NATIVE_MESSAGE',
      message: 'The native host sent an invalid message.'
    })
    ignoredDisconnects.add(nativePort)
    nativePort.disconnect()
  }

  const handleNativeMessage = (nativePort: NativePortLike, message: unknown): void => {
    if (!isRecord(message)) {
      rejectInvalidMessage(nativePort)

      return
    }

    if (isReadyMessage(message)) {
      cancelRetry()
      replaceState({
        connection: 'connected',
        optedIn: true,
        retry: { attempt: 0, scheduled: false }
      })

      return
    }

    if (isDisconnectedMessage(message)) {
      scheduleError({
        code: 'BRIDGE_DISCONNECTED',
        message: 'The Hermes bridge is not ready.'
      })

      return
    }

    if (isRequest(message)) {
      nativePort.postMessage({
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'This bridge method is not implemented by the extension shell.'
        },
        id: message.id,
        type: 'response'
      })

      return
    }

    rejectInvalidMessage(nativePort)
  }

  return {
    async connect(): Promise<void> {
      await dependencies.writeOptIn(true)
      cancelRetry()
      replaceState({
        connection: 'disconnected',
        optedIn: true,
        retry: { attempt: 0, scheduled: false }
      })
      connectNow()
    },

    async disconnect(): Promise<void> {
      await dependencies.writeOptIn(false)
      cancelRetry()
      closePort()
      replaceState({
        connection: 'disconnected',
        optedIn: false,
        retry: { attempt: 0, scheduled: false }
      })
    },

    getState(): ConnectionState {
      return copyState(state)
    },

    async start(): Promise<void> {
      const optedIn = await dependencies.readOptIn()
      replaceState({
        connection: 'disconnected',
        optedIn,
        retry: { attempt: 0, scheduled: false }
      })

      if (optedIn) { connectNow() }
    },

    subscribe(listener: (state: ConnectionState) => void): () => void {
      listeners.add(listener)
      listener(copyState(state))

      return () => listeners.delete(listener)
    }
  }
}
