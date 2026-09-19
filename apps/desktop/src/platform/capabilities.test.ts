import { describe, expect, it, vi } from 'vitest'

import { browserHostCapabilities, electronHostCapabilities } from './capabilities'
import type { HermesHost } from './types'

const browserEnvironment = {
  clipboard: true,
  microphone: true,
  notifications: false,
  screenWakeLock: true
}

describe('host capability contract', () => {
  it('combines backend manifest capabilities with browser feature detection', () => {
    const capabilities = browserHostCapabilities(
      {
        backendFiles: true,
        backendGit: false,
        backendLifecycle: true
      },
      browserEnvironment
    )

    expect(capabilities).toEqual({
      backendFiles: true,
      backendGit: false,
      backendLifecycle: true,
      browserClipboard: true,
      browserMicrophone: true,
      browserNotifications: false,
      deepLinkProtocol: false,
      nativeDialogs: false,
      nativeWindows: false,
      persistentTerminal: false,
      revealHostPath: false,
      screenWakeLock: true
    })
  })

  it('keeps static Electron capabilities client-owned and fails closed for backend features', () => {
    expect(electronHostCapabilities.backendFiles).toBe(false)
    expect(electronHostCapabilities.backendGit).toBe(false)
    expect(electronHostCapabilities.backendLifecycle).toBe(false)
    expect(electronHostCapabilities.deepLinkProtocol).toBe(true)
    expect(electronHostCapabilities.nativeDialogs).toBe(true)
    expect(electronHostCapabilities.nativeWindows).toBe(true)
    expect(electronHostCapabilities.persistentTerminal).toBe(true)
    expect(electronHostCapabilities.revealHostPath).toBe(true)

    const browser = browserHostCapabilities({}, browserEnvironment)
    expect(browser.nativeDialogs).toBe(false)
    expect(browser.nativeWindows).toBe(false)
    expect(browser.persistentTerminal).toBe(false)
    expect(browser.revealHostPath).toBe(false)
  })

  it('does not turn an available capability into an absent one when an operation fails', async () => {
    const failure = new Error('backend unavailable')

    const host: HermesHost = {
      kind: 'browser',
      capabilities: browserHostCapabilities({ backendFiles: true }, browserEnvironment),
      getConnection: vi.fn(),
      getGatewayWsUrl: vi.fn(),
      api: vi.fn(async () => {
        throw failure
      })
    }

    expect(host.capabilities.backendFiles).toBe(true)
    await expect(host.api({ path: '/api/files' })).rejects.toBe(failure)
    expect(host.capabilities.backendFiles).toBe(true)
  })
})
