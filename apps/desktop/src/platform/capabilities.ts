import type { HostCapabilities } from './types'

export type BackendCapabilityManifest = Pick<HostCapabilities, 'backendFiles' | 'backendGit' | 'backendLifecycle'>

export interface BrowserCapabilityEnvironment {
  clipboard: boolean
  microphone: boolean
  notifications: boolean
  screenWakeLock: boolean
}

function detectBrowserEnvironment(): BrowserCapabilityEnvironment {
  const nav = typeof navigator === 'undefined' ? undefined : navigator

  return {
    clipboard: Boolean(nav?.clipboard),
    microphone: Boolean(nav?.mediaDevices?.getUserMedia),
    notifications: typeof Notification !== 'undefined',
    screenWakeLock: Boolean(nav && 'wakeLock' in nav)
  }
}

export function browserHostCapabilities(
  manifest: Partial<BackendCapabilityManifest> = {},
  environment: BrowserCapabilityEnvironment = detectBrowserEnvironment()
): HostCapabilities {
  return {
    backendFiles: manifest.backendFiles === true,
    backendGit: manifest.backendGit === true,
    backendLifecycle: manifest.backendLifecycle === true,
    browserClipboard: environment.clipboard,
    browserMicrophone: environment.microphone,
    browserNotifications: environment.notifications,
    deepLinkProtocol: false,
    nativeDialogs: false,
    nativeWindows: false,
    persistentTerminal: false,
    revealHostPath: false,
    screenWakeLock: environment.screenWakeLock
  }
}

export const electronHostCapabilities: Readonly<HostCapabilities> = Object.freeze({
  backendFiles: false,
  backendGit: false,
  backendLifecycle: false,
  browserClipboard: true,
  browserMicrophone: true,
  browserNotifications: true,
  deepLinkProtocol: true,
  nativeDialogs: true,
  nativeWindows: true,
  persistentTerminal: true,
  revealHostPath: true,
  screenWakeLock: true
})
