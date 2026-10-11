import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hostKind = vi.hoisted(() => ({ value: 'browser' }))
vi.mock('@/platform/host', () => ({ tryResolveHost: () => ({ kind: hostKind.value }) }))

const originalBridge = window.hermesDesktop
beforeEach(() => {
  vi.resetModules()
  hostKind.value = 'browser'
  window.hermesDesktop = undefined as unknown as Window['hermesDesktop']
  localStorage.clear()
  document.documentElement.style.zoom = ''
})
afterEach(() => {
  window.hermesDesktop = originalBridge
  document.documentElement.style.zoom = ''
  document.documentElement.style.removeProperty('--browser-ui-scale')
  localStorage.clear()
})

describe('UI scale', () => {
  it('scales the browser document and persists across initialization without a native bridge', async () => {
    const zoom = await import('./zoom')
    expect(zoom.isUiScaleAvailable()).toBe(true)
    expect(zoom.$zoomPercent.get()).toBe(100)
    zoom.setZoomPercent(125)
    expect(document.documentElement.style.zoom).toBe('1.25')
    expect(document.documentElement.style.getPropertyValue('--browser-ui-scale')).toBe('1.25')
    expect(zoom.$zoomPercent.get()).toBe(125)
    vi.resetModules()
    const restored = await import('./zoom')
    expect(restored.$zoomPercent.get()).toBe(125)
    expect(document.documentElement.style.zoom).toBe('1.25')
  })

  it('rejects invalid saved values and bounds browser scale', async () => {
    localStorage.setItem('hermes.browser.uiScale.v1', 'NaN')
    const zoom = await import('./zoom')
    expect(zoom.$zoomPercent.get()).toBe(100)
    zoom.setZoomPercent(999)
    expect(zoom.$zoomPercent.get()).toBe(175)
    zoom.setZoomPercent(1)
    expect(zoom.$zoomPercent.get()).toBe(75)
    zoom.setZoomPercent(Number.NaN)
    expect(zoom.$zoomPercent.get()).toBe(100)
  })

  it('keeps Electron authoritative and never applies browser CSS zoom there', async () => {
    hostKind.value = 'electron'
    const setPercent = vi.fn()
    const onChanged = vi.fn()
    window.hermesDesktop = {
      zoom: { get: async () => ({ level: 0, percent: 110 }), setPercent, onChanged }
    } as unknown as Window['hermesDesktop']
    const zoom = await import('./zoom')
    zoom.setZoomPercent(125)
    expect(setPercent).toHaveBeenCalledWith(125)
    expect(zoom.$zoomPercent.get()).toBe(110)
    expect(document.documentElement.style.zoom).toBe('')
    expect(localStorage.getItem('hermes.browser.uiScale.v1')).toBeNull()
  })
})
