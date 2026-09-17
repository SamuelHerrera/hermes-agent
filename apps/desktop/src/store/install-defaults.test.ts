import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('fresh-install appearance', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('uses the shipped translucency only when no preference exists', async () => {
    const { $translucency, DEFAULT_TRANSLUCENCY, setTranslucency } = await import('./translucency')

    expect($translucency.get()).toBe(DEFAULT_TRANSLUCENCY)
    setTranslucency(0)
    vi.resetModules()
    expect((await import('./translucency')).$translucency.get()).toBe(0)
  })

  it('falls back for corrupt translucency without losing an explicit zero', async () => {
    window.localStorage.setItem('hermes.desktop.translucency.v1', 'not-a-number')
    const { $translucency, DEFAULT_TRANSLUCENCY } = await import('./translucency')

    expect($translucency.get()).toBe(DEFAULT_TRANSLUCENCY)
  })

  it('does not replace saved appearance choices with new defaults', async () => {
    window.localStorage.setItem('hermes.desktop.backdrop.v1', 'true')
    window.localStorage.setItem('hermes.desktop.translucency.v1', '35')
    const { $backdrop } = await import('./backdrop')
    const { $translucency } = await import('./translucency')

    expect($backdrop.get()).toBe(true)
    expect($translucency.get()).toBe(35)
  })
})
