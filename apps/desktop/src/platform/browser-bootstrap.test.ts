import { afterEach, describe, expect, it, vi } from 'vitest'

import { bootstrapBrowserHost, parseBrowserBootstrap } from './browser-bootstrap'
import { resetHostForTests, resolveHost } from './host'

const bootstrap = { authRequired: true, basePath: '/hermes', sessionToken: null }

afterEach(() => resetHostForTests())

describe('browser bootstrap', () => {
  it('parses only server-injected auth fields and rejects malformed values', () => {
    expect(
      parseBrowserBootstrap({
        authRequired: false,
        basePath: '/proxy/',
        sessionToken: 'once',
        attackerControlled: 'ignored'
      })
    ).toEqual({ authRequired: false, basePath: '/proxy', sessionToken: 'once' })
    expect(() => parseBrowserBootstrap({ authRequired: 'yes', basePath: '', sessionToken: null })).toThrow(
      /authRequired/
    )
    expect(() => parseBrowserBootstrap({ authRequired: false, basePath: 'https://evil.invalid', sessionToken: 'x' })).toThrow(
      /basePath/
    )
  })

  it('does not install a browser host when the Electron preload exists', async () => {
    const target = {
      hermesDesktop: { api: vi.fn(), getConnection: vi.fn(), getGatewayWsUrl: vi.fn() },
      __HERMES_DESKTOP_BOOTSTRAP__: bootstrap
    }

    const createHost = vi.fn()

    expect(await bootstrapBrowserHost(target as never, { createHost })).toBe(false)
    expect(createHost).not.toHaveBeenCalled()
  })

  it('installs the browser host before returning without persisting its token', async () => {
    const host = {
      kind: 'browser' as const,
      capabilities: {} as never,
      api: vi.fn(),
      getConnection: vi.fn(),
      getGatewayWsUrl: vi.fn()
    }

    const createHost = vi.fn(async () => host)
    const storage = { setItem: vi.fn() }
    const target = { __HERMES_DESKTOP_BOOTSTRAP__: { ...bootstrap, sessionToken: 'memory-only' }, localStorage: storage }

    expect(await bootstrapBrowserHost(target as never, { createHost })).toBe(true)
    expect(resolveHost()).toBe(host)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})
