import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { storedBoolean } from '@/lib/storage'

import { $keepAwake, refreshKeepAwake, setKeepAwake } from './keep-awake'

const KEY = 'hermes.desktop.keepAwake.v1'
const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
const initialHermesDesktop = desktopWindow.hermesDesktop
const getKeepAwakeBridge = vi.fn()
const setKeepAwakeBridge = vi.fn()

beforeEach(() => {
  desktopWindow.hermesDesktop = {
    getKeepAwake: getKeepAwakeBridge,
    setKeepAwake: setKeepAwakeBridge
  } as unknown as Window['hermesDesktop']
  $keepAwake.set(false)
  getKeepAwakeBridge.mockClear()
  setKeepAwakeBridge.mockClear()
})

afterEach(() => {
  desktopWindow.hermesDesktop = initialHermesDesktop
})

describe('keep-awake store', () => {
  it('persists the state confirmed by the main process', async () => {
    setKeepAwakeBridge.mockResolvedValueOnce({ ok: true, on: true })

    await setKeepAwake(true)
    expect($keepAwake.get()).toBe(true)
    expect(storedBoolean(KEY, false)).toBe(true)
    expect(setKeepAwakeBridge).toHaveBeenLastCalledWith(true)

    setKeepAwakeBridge.mockResolvedValueOnce({ ok: true, on: false })
    await setKeepAwake(false)
    expect(storedBoolean(KEY, true)).toBe(false)
    expect(setKeepAwakeBridge).toHaveBeenLastCalledWith(false)
  })

  it('rolls back when native authorization is cancelled', async () => {
    setKeepAwakeBridge.mockResolvedValueOnce({ ok: false, on: false, error: 'Administrator authorization was cancelled' })

    await setKeepAwake(true)

    expect($keepAwake.get()).toBe(false)
    expect(storedBoolean(KEY, true)).toBe(false)
  })

  it('reconciles persisted renderer state with the combined native state', async () => {
    $keepAwake.set(true)
    getKeepAwakeBridge.mockResolvedValueOnce({ ok: true, on: false })

    await refreshKeepAwake()

    expect($keepAwake.get()).toBe(false)
    expect(storedBoolean(KEY, true)).toBe(false)
  })

  it('does not let a stale refresh overwrite newer toolbar intent', async () => {
    let resolveRead!: (result: { ok: boolean; on: boolean }) => void

    getKeepAwakeBridge.mockReturnValueOnce(new Promise(resolve => (resolveRead = resolve)))
    setKeepAwakeBridge.mockResolvedValueOnce({ ok: true, on: true })

    const refresh = refreshKeepAwake()

    await setKeepAwake(true)
    resolveRead({ ok: true, on: false })
    await refresh

    expect($keepAwake.get()).toBe(true)
  })
})
