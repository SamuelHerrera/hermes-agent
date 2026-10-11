import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installHost, resetHostForTests } from '@/platform/host'
import type { HermesHost } from '@/platform/types'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { type RemoteBrowserHandle, RemoteBrowserViewport } from './remote-browser-viewport'

class Socket extends EventTarget {
  static instances: Socket[] = []
  readyState = 1
  send = vi.fn()
  close = vi.fn()
  constructor(public url: string) {
    super()
    Socket.instances.push(this)
  }
  message(frame: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }))
  }
}

function setup() {
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  const getGatewayWsUrl = vi.fn(async () => 'wss://backend.test/prefix/api/ws?ticket=fresh')
  installHost({
    kind: 'browser',
    api: vi.fn(),
    capabilities: {} as HermesHost['capabilities'],
    getConnection: vi.fn(),
    getGatewayWsUrl
  })

  return getGatewayWsUrl
}

afterEach(() => {
  cleanup()
  resetHostForTests()
  $connection.set(null)
  $activeGatewayProfile.set('default')
  vi.unstubAllGlobals()
})

describe('remote browser viewport', () => {
  it('forwards controls and keyboard input without exposing website HTML', async () => {
    setup()
    const ref = createRef<RemoteBrowserHandle>()
    const onState = vi.fn()
    const rendered = render(<RemoteBrowserViewport initialUrl="about:blank" onState={onState} ref={ref} />)
    act(() => ref.current?.send({ type: 'navigate', url: 'https://queued.test/' }))
    await waitFor(() => expect(Socket.instances).toHaveLength(1))
    const socket = Socket.instances[0]
    act(() => socket.message({ type: 'ready', protocol: 1 }))
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'navigate', url: 'https://queued.test/' }))
    expect(socket.send.mock.calls.filter(([value]) => JSON.parse(value).type === 'navigate')).toHaveLength(1)
    act(() =>
      socket.message({
        type: 'frame',
        image: '/9j/AA==',
        url: 'http://backend-only.test',
        title: '<script>bad</script>',
        width: 390,
        height: 640
      })
    )
    expect(screen.getByAltText('Backend browser page').getAttribute('src')).toBe('data:image/jpeg;base64,/9j/AA==')
    expect(rendered.container.querySelector('iframe,webview,script')).toBeNull()
    // Identical raster frames must still be acknowledged; React won't fire an
    // image load event when a static page's src does not change.
    act(() =>
      socket.message({
        type: 'frame',
        image: '/9j/AA==',
        url: 'http://backend-only.test',
        title: 'same',
        width: 390,
        height: 640
      })
    )
    expect(socket.send.mock.calls.filter(([value]) => JSON.parse(value).type === 'ack')).toHaveLength(2)
    const viewport = screen.getByRole('application')
    fireEvent.keyDown(viewport, { key: 'a' })
    fireEvent.keyDown(viewport, { key: 'Backspace' })
    fireEvent.wheel(viewport, { deltaX: 0, deltaY: 400 })
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'type', text: 'a' }))
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'key', key: 'Backspace' }))
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'scroll', deltaX: 0, deltaY: 400 }))
    act(() => ref.current?.send({ type: 'back' }))
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard' }))
    fireEvent.change(screen.getByLabelText('Type into remote page'), { target: { value: 'phone text' } })
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'type', text: 'phone text' }))
    rendered.unmount()
    expect(socket.close).toHaveBeenCalledOnce()
  })

  it('closes old ownership on profile switch and mints a fresh ticket', async () => {
    const mint = setup()
    const rendered = render(<RemoteBrowserViewport initialUrl="about:blank" onState={vi.fn()} />)
    await waitFor(() => expect(Socket.instances).toHaveLength(1))
    act(() => $activeGatewayProfile.set('work'))
    await waitFor(() => expect(Socket.instances).toHaveLength(2))
    expect(Socket.instances[0].close).toHaveBeenCalledOnce()
    expect(mint).toHaveBeenCalledTimes(2)
    rendered.unmount()
    expect(Socket.instances[1].close).toHaveBeenCalledOnce()
  })

  it('surfaces unavailable backends and reconnects without OS fallback', async () => {
    const mint = setup()
    render(<RemoteBrowserViewport initialUrl="about:blank" onState={vi.fn()} />)
    await waitFor(() => expect(Socket.instances).toHaveLength(1))
    act(() => Socket.instances[0].dispatchEvent(new CloseEvent('close', { code: 4404 })))
    expect(screen.getByRole('alert').textContent).toContain('4404')
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(2))
    expect(Socket.instances[0].close).toHaveBeenCalledOnce()
  })
})
