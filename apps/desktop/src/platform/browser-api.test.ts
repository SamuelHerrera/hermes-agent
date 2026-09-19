import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBrowserApi } from './browser-api'

const config = { authRequired: false, basePath: '/proxy', sessionToken: 'ephemeral' }

afterEach(() => vi.useRealTimers())

describe('browser API transport', () => {
  it('uses same-origin credentials, injected token auth, JSON body, and profile scoping', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    const api = createBrowserApi(config, { fetch: fetcher })

    await api({ path: '/api/settings?view=compact', method: 'POST', body: { enabled: true }, profile: 'research' })

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    const requestInit = init!

    expect(url).toBe('/proxy/api/settings?view=compact&profile=research')
    expect(requestInit.credentials).toBe('include')
    expect(requestInit.method).toBe('POST')
    expect(requestInit.body).toBe('{"enabled":true}')
    expect(new Headers(requestInit.headers).get('X-Hermes-Session-Token')).toBe('ephemeral')
    expect(new Headers(requestInit.headers).get('Content-Type')).toBe('application/json')
  })

  it('never sends a token header in cookie-auth mode', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    const api = createBrowserApi({ authRequired: true, basePath: '', sessionToken: null }, { fetch: fetcher })

    await api({ path: '/api/status' })

    expect(new Headers(fetcher.mock.calls[0][1]!.headers).has('X-Hermes-Session-Token')).toBe(false)
  })

  it('reports JSON and non-JSON HTTP failures without parse noise', async () => {
    const jsonApi = createBrowserApi(config, {
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ detail: 'denied' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      )
    })

    const textApi = createBrowserApi(config, {
      fetch: vi.fn(async () => new Response('upstream exploded', { status: 502, headers: { 'Content-Type': 'text/plain' } }))
    })

    await expect(jsonApi({ path: '/api/private' })).rejects.toMatchObject({ status: 403, message: expect.stringContaining('denied') })
    await expect(textApi({ path: '/api/private' })).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('upstream exploded')
    })
  })

  it('aborts requests at the requested timeout', async () => {
    vi.useFakeTimers()

    const fetcher = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        )
      )
    )

    const api = createBrowserApi(config, { fetch: fetcher, defaultTimeoutMs: 50 })

    const request = expect(api({ path: '/api/slow', timeoutMs: 10 })).rejects.toMatchObject({
      code: 'timeout',
      status: null
    })

    await vi.advanceTimersByTimeAsync(11)

    await request
  })

  it('rejects absolute URLs and native multipart uploads', async () => {
    const api = createBrowserApi(config, { fetch: vi.fn() })

    await expect(api({ path: 'https://evil.invalid/api' })).rejects.toThrow(/relative \/api/)
    await expect(
      api({ path: '/api/files', upload: { filename: 'x', bytes: new ArrayBuffer(0) } })
    ).rejects.toThrow(/upload/i)
  })
})
