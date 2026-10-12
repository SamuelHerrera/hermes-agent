import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installHost, resetHostForTests } from '@/platform/host'
import type { HermesHost } from '@/platform/types'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { type RemoteBrowserHandle, RemoteBrowserViewport } from './remote-browser-viewport'

function setup(origin = 'https://proxy.example.net', extra = {}) {
  const api = vi.fn(async () => ({ origin, ticket: 'proxy-only-ticket-1234567890123456', expiresIn: 30_000, ...extra }))
  installHost({
    kind: 'browser',
    api: api as HermesHost['api'],
    capabilities: {} as HermesHost['capabilities'],
    getConnection: vi.fn(),
    getGatewayWsUrl: vi.fn()
  })

  return api
}

afterEach(() => {
  cleanup()
  window.document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(meta => meta.remove())
  resetHostForTests()
  $connection.set(null)
  $activeGatewayProfile.set('default')
})

describe('isolated client browser', () => {
  it('uses the dedicated prefix only for an explicitly granted same-origin mode', async () => {
    setup('https://localhost', { sameOrigin: true, path: '/browser-proxy/' })
    render(<RemoteBrowserViewport initialUrl="about:blank" onState={vi.fn()} />)
    const iframe = (await screen.findByTitle('Isolated browser')) as HTMLIFrameElement
    expect(iframe.src).toBe('https://localhost/browser-proxy/#ticket=proxy-only-ticket-1234567890123456')
    expect(screen.queryByText(/Development mode: browsing shares Hermes/)).toBeNull()
  })
  it('bootstraps on Hermes and sends controls only to exact iframe origin and source', async () => {
    const api = setup()
    const ref = createRef<RemoteBrowserHandle>()
    const onState = vi.fn()
    render(<RemoteBrowserViewport initialUrl="https://example.com/" onState={onState} ref={ref} />)
    const iframe = (await screen.findByTitle('Isolated browser')) as HTMLIFrameElement
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/browser-proxy/bootstrap', method: 'POST' }))
    expect(iframe.src).toBe('https://proxy.example.net/#ticket=proxy-only-ticket-1234567890123456')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-top-navigation')
    const policy = window.document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')
    expect(policy?.content).toBe("frame-src https://proxy.example.net blob: data:; object-src 'none'")
    expect(policy?.content).not.toContain("'self'")
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage')

    const message = (source: MessageEventSource | null, origin: string, data: unknown) =>
      act(() => window.dispatchEvent(new MessageEvent('message', { source, origin, data })))

    message(window, 'https://proxy.example.net', { protocol: 'hermes-proxy-v1', type: 'ready' })
    expect(post).not.toHaveBeenCalled()
    message(iframe.contentWindow, 'https://evil.example', { protocol: 'hermes-proxy-v1', type: 'ready' })
    expect(post).not.toHaveBeenCalled()
    message(iframe.contentWindow, 'https://proxy.example.net', { protocol: 'hermes-proxy-v1', type: 'ready' })
    expect(post).toHaveBeenCalledWith(
      { protocol: 'hermes-proxy-v1', command: { type: 'navigate', url: 'https://example.com/' } },
      'https://proxy.example.net'
    )
    act(() => ref.current?.send({ type: 'back' }))
    expect(post).toHaveBeenLastCalledWith(
      { protocol: 'hermes-proxy-v1', command: { type: 'back' } },
      'https://proxy.example.net'
    )
    message(iframe.contentWindow, 'https://proxy.example.net', {
      protocol: 'hermes-proxy-v1',
      type: 'state',
      url: 'javascript:evil()',
      title: '<script>',
      loading: false
    })
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ url: 'javascript:evil()' }))
  })

  it('rejects same-host proxy configuration before rendering untrusted HTML', async () => {
    setup(window.location.origin)
    render(<RemoteBrowserViewport initialUrl="about:blank" onState={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('separate HTTPS')
    expect(screen.queryByTitle('Isolated browser')).toBeNull()
  })

  it('obtains fresh ownership on profile change and supports bounded reconnect', async () => {
    const api = setup()
    render(<RemoteBrowserViewport initialUrl="about:blank" onState={vi.fn()} />)
    await screen.findByTitle('Isolated browser')
    act(() => $activeGatewayProfile.set('work'))
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2))
    const iframe = screen.getByTitle('Isolated browser') as HTMLIFrameElement
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe.contentWindow,
          origin: 'https://proxy.example.net',
          data: { protocol: 'hermes-proxy-v1', type: 'error', error: 'Expired' }
        })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3))
  })
})
