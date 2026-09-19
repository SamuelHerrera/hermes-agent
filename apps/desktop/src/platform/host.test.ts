import { afterEach, describe, expect, it, vi } from 'vitest'

import { electronHostCapabilities } from './capabilities'
import { installHost, resetHostForTests, resolveHost } from './host'
import type { HermesHost } from './types'

function browserHost(): HermesHost {
  return {
    kind: 'browser',
    capabilities: { ...electronHostCapabilities, nativeDialogs: false, nativeWindows: false },
    getConnection: vi.fn(),
    getGatewayWsUrl: vi.fn(),
    api: vi.fn()
  }
}

afterEach(() => {
  resetHostForTests()
  delete (window as { hermesDesktop?: unknown }).hermesDesktop
})

describe('resolveHost', () => {
  it('prefers an explicitly installed browser host over the Electron preload', () => {
    const installed = browserHost()

    ;(window as { hermesDesktop?: unknown }).hermesDesktop = {
      getConnection: vi.fn(),
      getGatewayWsUrl: vi.fn(),
      api: vi.fn()
    }

    installHost(installed)

    expect(resolveHost()).toBe(installed)
  })

  it('wraps the Electron preload while preserving profile-scoped routing', async () => {
    const getConnection = vi.fn(async (profile?: null | string) => ({ profile }))
    const getGatewayWsUrl = vi.fn(async (profile?: null | string) => `wss://gateway.invalid/${profile}`)

    const api = vi.fn(async (request: unknown) => request)

    ;(window as { hermesDesktop?: unknown }).hermesDesktop = { getConnection, getGatewayWsUrl, api }

    const host = resolveHost()

    expect(host.kind).toBe('electron')
    expect(host.capabilities).toBe(electronHostCapabilities)
    await host.getConnection('research')
    await host.getGatewayWsUrl('research')
    await host.api({ path: '/api/status', profile: 'research' })
    expect(getConnection).toHaveBeenCalledWith('research')
    expect(getGatewayWsUrl).toHaveBeenCalledWith('research')
    expect(api).toHaveBeenCalledWith({ path: '/api/status', profile: 'research' })
  })

  it('fails with an actionable message when no host is installed', () => {
    expect(() => resolveHost()).toThrow(/installHost.*hermesDesktop/)
  })
})
