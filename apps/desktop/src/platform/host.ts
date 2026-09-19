import { createElectronHost } from './electron-host'
import type { HermesHost } from './types'

let installedHost: HermesHost | null = null

export function installHost(host: HermesHost): void {
  installedHost = host
}

export function tryResolveHost(): HermesHost | null {
  if (installedHost) {
    return installedHost
  }

  if (typeof window !== 'undefined' && window.hermesDesktop) {
    return createElectronHost(window.hermesDesktop)
  }

  return null
}

export function resolveHost(): HermesHost {
  const host = tryResolveHost()

  if (host) {return host}

  throw new Error(
    'Hermes host is unavailable. Browser entry points must call installHost(...) before boot; Electron requires window.hermesDesktop from the preload.'
  )
}

export function resetHostForTests(): void {
  installedHost = null
}
