import { describe, expect, it, vi } from 'vitest'

import { createBrowserLifecycle } from './browser-lifecycle'
import type { HermesHost } from './types'

const capabilities = {
  backendFiles: true,
  backendGit: true,
  backendLifecycle: true,
  browserClipboard: true,
  browserMicrophone: true,
  browserNotifications: true,
  clipboard: true,
  deepLinkProtocol: false,
  externalLinks: true,
  globalHotkeys: false,
  mediaCapture: true,
  nativeNotifications: false,
  nativeDialogs: false,
  nativeWindows: false,
  persistentTerminal: true,
  revealHostPath: false,
  screenWakeLock: true,
  systemAppearance: true,
  windowBelow: false
}

function host(api: HermesHost['api']): HermesHost {
  return { kind: 'browser', capabilities, api, getConnection: vi.fn(), getGatewayWsUrl: vi.fn() }
}

describe('browser lifecycle adapter', () => {
  it('reads status and sends only the fixed action contract', async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ version: 1, authority: { externally_managed: false, kind: 'none' }, actions: {} })
      .mockResolvedValueOnce({ ok: true, action: 'gateway-restart', relaunch: false })

    const lifecycle = createBrowserLifecycle(host(api))

    await lifecycle.status()
    const result = await lifecycle.run('gateway-restart')

    expect(api.mock.calls).toEqual([
      [{ path: '/api/lifecycle' }],
      [{ path: '/api/lifecycle/action', method: 'POST', body: { action: 'gateway-restart' } }]
    ])
    expect(result.relaunch).toBe(false)
  })

  it('passes explicit uninstall confirmation', async () => {
    const api = vi.fn().mockResolvedValue({ ok: true, action: 'uninstall', relaunch: false })
    await createBrowserLifecycle(host(api)).run('uninstall', 'UNINSTALL')
    expect(api).toHaveBeenCalledWith({
      path: '/api/lifecycle/action',
      method: 'POST',
      body: { action: 'uninstall', confirmation: 'UNINSTALL' }
    })
  })

  it('polls status until the same backend reconnects without claiming a relaunch', async () => {
    const api = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ version: 1, authority: { externally_managed: true, kind: 'systemd' }, actions: {} })

    const lifecycle = createBrowserLifecycle(host(api), { delay: async () => {}, attempts: 2 })

    const status = await lifecycle.waitUntilAvailable()

    expect(api).toHaveBeenCalledTimes(2)
    expect(status.version).toBe(1)
  })

  it('does not report an HTTP action failure as a successful reconnect', async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({
        version: 1,
        authority: { externally_managed: true, kind: 'launchd' },
        actions: { 'backend-restart': { supported: true, guidance: '' } }
      })
      .mockRejectedValueOnce(Object.assign(new Error('500: restart failed'), { code: 'http' }))

    const lifecycle = createBrowserLifecycle(host(api), { delay: async () => {}, attempts: 1 })

    await expect(lifecycle.runAndReconnect('backend-restart')).rejects.toThrow('restart failed')
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('fails closed when backend lifecycle was not advertised', async () => {
    const unsupported = host(vi.fn())
    unsupported.capabilities = { ...capabilities, backendLifecycle: false }
    expect(() => createBrowserLifecycle(unsupported).status()).toThrow('unsupported')
  })
})
