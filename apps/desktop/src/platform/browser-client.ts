export type BrowserCapabilityErrorCode =
  | 'denied'
  | 'insecure'
  | 'prompt'
  | 'revoked'
  | 'unavailable'
  | 'user-gesture'

export class BrowserCapabilityError extends Error {
  constructor(readonly code: BrowserCapabilityErrorCode, message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'BrowserCapabilityError'
  }
}

export type BrowserPermissionState = 'denied' | 'granted' | 'prompt' | 'unavailable'

export interface BrowserClientApis {
  clipboard: { read(): Promise<string>; write(text: string): Promise<void> }
  microphone(constraints: MediaStreamConstraints): Promise<MediaStream>
  notifications: {
    permission(): Promise<BrowserPermissionState>
    requestPermission(): Promise<BrowserPermissionState>
    show(title: string, options?: NotificationOptions): boolean
  }
  wakeLock: { set(on: boolean): Promise<boolean> }
  openExternal(url: string): boolean
  onReconnect(callback: (state: { online: boolean; visible: boolean }) => void): () => void
}

interface BrowserGlobals {
  document: Document
  navigator: Navigator
  Notification?: typeof Notification
  window: Window
}

function capabilityError(error: unknown, fallback: BrowserCapabilityErrorCode): BrowserCapabilityError {
  if (error instanceof BrowserCapabilityError) {
    return error
  }
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new BrowserCapabilityError('denied', 'The browser denied this capability.', error)
  }
  if (name === 'InvalidStateError') {
    return new BrowserCapabilityError('user-gesture', 'This capability requires an active page and user gesture.', error)
  }
  if (name === 'AbortError' || name === 'NotReadableError') {
    return new BrowserCapabilityError('revoked', 'The browser capability was revoked or lost.', error)
  }
  return new BrowserCapabilityError(fallback, 'The browser capability is unavailable.', error)
}

function requireSecure(globals: BrowserGlobals): void {
  if (globals.window.isSecureContext === false) {
    throw new BrowserCapabilityError('insecure', 'This browser capability requires HTTPS or localhost.')
  }
}

function notificationState(value: NotificationPermission): BrowserPermissionState {
  return value === 'default' ? 'prompt' : value
}

function validatedExternalUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function createBrowserClientApis(globals: BrowserGlobals = {
  document,
  navigator,
  Notification: typeof Notification === 'undefined' ? undefined : Notification,
  window
}): BrowserClientApis {
  let wakeLock: WakeLockSentinel | null = null
  let wakeLockDesired = false
  let wakeLockGeneration = 0

  const acquireWakeLock = async (): Promise<boolean> => {
    const generation = wakeLockGeneration

    requireSecure(globals)
    if (!globals.navigator.wakeLock?.request) {
      throw new BrowserCapabilityError('unavailable', 'Screen wake lock is unavailable.')
    }
    try {
      const sentinel = await globals.navigator.wakeLock.request('screen')

      if (!wakeLockDesired || generation !== wakeLockGeneration) {
        if (!sentinel.released) {
          await sentinel.release()
        }

        return false
      }

      wakeLock = sentinel
      sentinel.addEventListener('release', () => {
        if (wakeLock === sentinel) {
          wakeLock = null
        }
      })
      return true
    } catch (error) {
      throw capabilityError(error, 'unavailable')
    }
  }

  globals.document.addEventListener('visibilitychange', () => {
    if (wakeLockDesired && globals.document.visibilityState === 'visible' && !wakeLock) {
      void acquireWakeLock().catch(() => undefined)
    }
  })

  return {
    clipboard: {
      async read() {
        requireSecure(globals)
        if (!globals.navigator.clipboard?.readText) {
          throw new BrowserCapabilityError('unavailable', 'Clipboard read is unavailable.')
        }
        try {
          return await globals.navigator.clipboard.readText()
        } catch (error) {
          throw capabilityError(error, 'unavailable')
        }
      },
      async write(text) {
        requireSecure(globals)
        if (!globals.navigator.clipboard?.writeText) {
          throw new BrowserCapabilityError('unavailable', 'Clipboard write is unavailable.')
        }
        try {
          await globals.navigator.clipboard.writeText(text)
        } catch (error) {
          throw capabilityError(error, 'unavailable')
        }
      }
    },
    async microphone(constraints) {
      requireSecure(globals)
      if (!globals.navigator.mediaDevices?.getUserMedia) {
        throw new BrowserCapabilityError('unavailable', 'Microphone capture is unavailable.')
      }
      try {
        return await globals.navigator.mediaDevices.getUserMedia(constraints)
      } catch (error) {
        throw capabilityError(error, 'unavailable')
      }
    },
    notifications: {
      async permission() {
        return globals.Notification ? notificationState(globals.Notification.permission) : 'unavailable'
      },
      async requestPermission() {
        requireSecure(globals)
        if (!globals.Notification?.requestPermission) {
          return 'unavailable'
        }
        try {
          return notificationState(await globals.Notification.requestPermission())
        } catch (error) {
          throw capabilityError(error, 'unavailable')
        }
      },
      show(title, options) {
        if (!globals.Notification || globals.Notification.permission !== 'granted') {
          return false
        }
        try {
          new globals.Notification(title, options)
          return true
        } catch {
          return false
        }
      }
    },
    wakeLock: {
      async set(on) {
        wakeLockDesired = on
        wakeLockGeneration += 1
        if (!on) {
          const active = wakeLock
          wakeLock = null
          if (active && !active.released) {
            await active.release()
          }
          return false
        }
        if (globals.document.visibilityState !== 'visible') {
          return false
        }
        return acquireWakeLock()
      }
    },
    openExternal(value) {
      const url = validatedExternalUrl(value)
      if (!url) {
        return false
      }
      const opened = globals.window.open(url, '_blank', 'noopener,noreferrer')
      if (opened) {
        opened.opener = null
      }
      return Boolean(opened)
    },
    onReconnect(callback) {
      const publish = () => callback({
        online: globals.navigator.onLine !== false,
        visible: globals.document.visibilityState === 'visible'
      })
      globals.window.addEventListener('online', publish)
      globals.window.addEventListener('offline', publish)
      globals.document.addEventListener('visibilitychange', publish)
      return () => {
        globals.window.removeEventListener('online', publish)
        globals.window.removeEventListener('offline', publish)
        globals.document.removeEventListener('visibilitychange', publish)
      }
    }
  }
}

let singleton: BrowserClientApis | null = null

export function browserClientApis(): BrowserClientApis {
  singleton ??= createBrowserClientApis()
  return singleton
}

export function resetBrowserClientApisForTests(): void {
  singleton = null
}
