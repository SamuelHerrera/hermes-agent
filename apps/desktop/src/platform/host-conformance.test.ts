import { describe, expect, it, vi } from 'vitest'

import { createBrowserHost } from './browser-host'
import { createElectronHost } from './electron-host'
import type { HermesHost } from './types'

async function exerciseCommonContract(host: HermesHost) {
  const connection = await host.getConnection('work')
  const wsUrl = await host.getGatewayWsUrl('work')
  const apiResult = await host.api?.<{ ok: boolean }>({ path: '/api/capabilities', profile: 'work' })

  return { apiResult, connection, wsUrl }
}

describe('Hermes host conformance', () => {
  it('keeps Electron common operations behind the explicit preload bridge', async () => {
    const bridge = {
      api: vi.fn(async () => ({ ok: true })),
      getConnection: vi.fn(async profile => ({ mode: 'local', profile })),
      getGatewayWsUrl: vi.fn(async profile => `ws://electron.test/api/ws?profile=${profile}`)
    }
    const result = await exerciseCommonContract(createElectronHost(bridge as never))

    expect(result.connection).toMatchObject({ mode: 'local', profile: 'work' })
    expect(result.wsUrl).toContain('profile=work')
    expect(result.apiResult).toEqual({ ok: true })
    expect(bridge.api).toHaveBeenCalledWith({ path: '/api/capabilities', profile: 'work' })
  })

  it('keeps browser common operations on authenticated backend transports', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        version: 1,
        capabilities: { files: true, git: true, lifecycle: true, persistentTerminal: true }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ticket: 'fresh-ticket' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const host = await createBrowserHost(
      { authRequired: true, basePath: '', sessionToken: null },
      {
        fetch: fetcher,
        location: { host: 'backend.test', origin: 'https://backend.test', protocol: 'https:' },
        environment: { clipboard: true, microphone: true, notifications: true, screenWakeLock: true }
      }
    )
    const result = await exerciseCommonContract(host)

    expect(result.connection).toMatchObject({ mode: 'remote', profile: 'work' })
    expect(result.wsUrl).toContain('ticket=fresh-ticket')
    expect(result.apiResult).toEqual({ ok: true })
    expect(host.capabilities).toMatchObject({
      backendFiles: true,
      backendGit: true,
      backendLifecycle: true,
      persistentTerminal: true,
      nativeWindows: false
    })
  })
})
