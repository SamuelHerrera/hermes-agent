import { describe, expect, it, vi } from 'vitest'

import { createBrowserHost } from './browser-host'

const location = { host: 'agent.example:9443', origin: 'https://agent.example:9443', protocol: 'https:' }

describe('browser host', () => {
  it('loads backend truth, merges browser features, and returns a current profile descriptor', async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      expect(url).toBe('/hermes/api/capabilities')

      return new Response(
        JSON.stringify({
          version: 1,
          capabilities: { files: true, git: false, persistentTerminal: true, lifecycle: true }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    })

    const host = await createBrowserHost(
      { authRequired: false, basePath: '/hermes', sessionToken: 'short-lived' },
      {
        fetch: fetcher,
        location,
        environment: { clipboard: true, microphone: false, notifications: true, screenWakeLock: false }
      }
    )

    expect(host.capabilities).toMatchObject({
      backendFiles: true,
      backendGit: false,
      backendLifecycle: true,
      persistentTerminal: true,
      browserClipboard: true,
      browserMicrophone: false,
      nativeDialogs: false,
      nativeWindows: false
    })
    await expect(host.getConnection('research')).resolves.toMatchObject({
      authMode: 'token',
      baseUrl: 'https://agent.example:9443/hermes',
      mode: 'remote',
      profile: 'research',
      token: 'short-lived'
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('mints a fresh cookie-auth ticket immediately before every WebSocket dial', async () => {
    let ticket = 0

    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/capabilities')) {
        return new Response(JSON.stringify({ version: 1, capabilities: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      ticket += 1

      return new Response(JSON.stringify({ ticket: `fresh-${ticket}`, ttl_seconds: 30 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    const host = await createBrowserHost(
      { authRequired: true, basePath: '/hermes', sessionToken: null },
      { fetch: fetcher, location }
    )

    await host.getConnection('worker')
    const first = await host.getGatewayWsUrl('worker')
    const second = await host.getGatewayWsUrl('worker')

    expect(first).toBe('wss://agent.example:9443/hermes/api/ws?profile=worker&ticket=fresh-1')
    expect(second).toBe('wss://agent.example:9443/hermes/api/ws?profile=worker&ticket=fresh-2')
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/api/auth/ws-ticket'))).toHaveLength(2)
  })

  it('treats a missing capability endpoint as chat-only compatibility', async () => {
    const host = await createBrowserHost(
      { authRequired: false, basePath: '', sessionToken: 'token' },
      { fetch: vi.fn(async () => new Response(JSON.stringify({ detail: 'missing' }), { status: 404 })), location }
    )

    expect(host.capabilities.backendFiles).toBe(false)
    expect(host.capabilities.backendGit).toBe(false)
    expect(host.capabilities.backendLifecycle).toBe(false)
    expect(host.capabilities.persistentTerminal).toBe(false)
  })
})
