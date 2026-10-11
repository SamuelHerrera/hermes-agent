import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./zoom', () => ({ $zoomPercent: { listen: () => () => {} } }))

const originalWidth = window.innerWidth
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  document.documentElement.style.zoom = ''
})

describe('sidebar viewport authority', () => {
  it('docks the chats panel when browser UI zoom makes room without changing device width', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 574 })
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn() }))
    )
    const { $narrowViewport: $sidebarNarrowViewport } = await import('@/components/pane-shell/tree/store')
    document.documentElement.style.zoom = '1'
    window.dispatchEvent(new Event('resize'))
    expect($sidebarNarrowViewport.get()).toBe(true)
    document.documentElement.style.zoom = '0.75'
    window.dispatchEvent(new Event('resize'))
    expect($sidebarNarrowViewport.get()).toBe(false)

    for (let frame = 0; frame < 20; frame++) {
      window.dispatchEvent(new Event('resize'))
      expect($sidebarNarrowViewport.get()).toBe(false)
    }

    document.documentElement.style.zoom = '1'
    window.dispatchEvent(new Event('resize'))
    expect($sidebarNarrowViewport.get()).toBe(true)
  })
})
