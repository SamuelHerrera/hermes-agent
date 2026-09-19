import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBrowserClientApis, BrowserCapabilityError } from './browser-client'

function globals(overrides: Record<string, unknown> = {}) {
  const opened = { opener: {} as unknown }
  const windowLike = {
    addEventListener: vi.fn(),
    open: vi.fn(() => opened),
    removeEventListener: vi.fn(),
    ...overrides
  } as unknown as Window
  const documentLike = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    visibilityState: 'visible',
    ...overrides.document as object
  } as unknown as Document
  return { documentLike, opened, windowLike }
}

describe('browser-local client APIs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses clipboard and microphone APIs and reports unavailable or denied states explicitly', async () => {
    const writeText = vi.fn(async () => undefined)
    const readText = vi.fn(async () => 'copied')
    const getUserMedia = vi.fn(async () => ({ id: 'stream' }))
    const { documentLike, windowLike } = globals()
    const api = createBrowserClientApis({
      document: documentLike,
      navigator: { clipboard: { readText, writeText }, mediaDevices: { getUserMedia } } as unknown as Navigator,
      window: windowLike
    })
    await expect(api.clipboard.read()).resolves.toBe('copied')
    await api.clipboard.write('hello')
    await expect(api.microphone({ audio: true })).resolves.toEqual({ id: 'stream' })
    expect(writeText).toHaveBeenCalledWith('hello')

    writeText.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'))
    await expect(api.clipboard.write('x')).rejects.toMatchObject({ code: 'denied' })

    const unavailable = createBrowserClientApis({ document: documentLike, navigator: {} as Navigator, window: windowLike })
    await expect(unavailable.microphone({ audio: true })).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('handles notification permission without treating prompt as granted', async () => {
    const { documentLike, windowLike } = globals()
    class FakeNotification {
      static permission: NotificationPermission = 'default'
      static requestPermission = vi.fn(async () => 'denied' as NotificationPermission)
      constructor() {}
    }
    const api = createBrowserClientApis({
      document: documentLike,
      navigator: {} as Navigator,
      Notification: FakeNotification as unknown as typeof Notification,
      window: windowLike
    })
    await expect(api.notifications.permission()).resolves.toBe('prompt')
    await expect(api.notifications.requestPermission()).resolves.toBe('denied')
  })

  it('reacquires a revoked wake lock after the document becomes visible', async () => {
    const first = { addEventListener: vi.fn(), release: vi.fn(async () => undefined), released: false }
    const second = { addEventListener: vi.fn(), release: vi.fn(async () => undefined), released: false }
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { documentLike, windowLike } = globals()
    const api = createBrowserClientApis({
      document: documentLike,
      navigator: { wakeLock: { request } } as unknown as Navigator,
      window: windowLike
    })
    await api.wakeLock.set(true)
    const release = first.addEventListener.mock.calls.find(call => call[0] === 'release')?.[1]
    release()
    const visibility = (documentLike.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(call => call[0] === 'visibilitychange')?.[1]
    await visibility()
    expect(request).toHaveBeenCalledTimes(2)
    await api.wakeLock.set(false)
    expect(second.release).toHaveBeenCalled()
  })

  it('only opens validated web links with noopener,noreferrer and exposes reconnect signals', () => {
    const { documentLike, opened, windowLike } = globals()
    const api = createBrowserClientApis({ document: documentLike, navigator: { onLine: true } as Navigator, window: windowLike })
    expect(api.openExternal('https://example.com/path')).toBe(true)
    expect(windowLike.open).toHaveBeenCalledWith('https://example.com/path', '_blank', 'noopener,noreferrer')
    expect(opened.opener).toBeNull()
    expect(api.openExternal('javascript:alert(1)')).toBe(false)
    expect(api.openExternal('file:///etc/passwd')).toBe(false)

    const reconnect = vi.fn()
    const cleanup = api.onReconnect(reconnect)
    const online = (windowLike.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(call => call[0] === 'online')?.[1]
    online()
    expect(reconnect).toHaveBeenCalledWith({ online: true, visible: true })
    cleanup()
    expect(windowLike.removeEventListener).toHaveBeenCalledWith('online', online)
  })

  it('requires secure context for sensitive browser APIs', async () => {
    const { documentLike, windowLike } = globals({ isSecureContext: false })
    const api = createBrowserClientApis({ document: documentLike, navigator: {} as Navigator, window: windowLike })
    await expect(api.clipboard.write('x')).rejects.toEqual(expect.objectContaining<Partial<BrowserCapabilityError>>({ code: 'insecure' }))
  })
})
