import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { storedBoolean } from '@/lib/storage'

const KEY = 'hermes.desktop.keepAwake.v1'
const hostApiMock = vi.hoisted(() => vi.fn())
const tryResolveHostMock = vi.hoisted(() => vi.fn())
const getApiRequestProfileMock = vi.hoisted(() => vi.fn())

vi.mock('@/platform/host-api', () => ({ hostApi: hostApiMock }))
vi.mock('@/platform/host', () => ({ tryResolveHost: tryResolveHostMock }))
vi.mock('@/hermes', () => ({ getApiRequestProfile: getApiRequestProfileMock }))
vi.mock('@/store/profile', () => ({ $activeGatewayProfile: atom('default') }))

import { $keepAwake, refreshKeepAwake, setKeepAwake } from './keep-awake'

const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
const initialHermesDesktop = desktopWindow.hermesDesktop
const getKeepAwakeBridge = vi.fn()
const setKeepAwakeBridge = vi.fn()

const keepAwakeHost = { capabilities: { keepAwake: true, screenWakeLock: true } }
const localOnlyHost = { capabilities: { keepAwake: false, screenWakeLock: true } }

beforeEach(() => {
  desktopWindow.hermesDesktop = {
    getKeepAwake: getKeepAwakeBridge,
    setKeepAwake: setKeepAwakeBridge
  } as unknown as Window['hermesDesktop']
  localStorage.removeItem(KEY)
  $keepAwake.set(false)
  hostApiMock.mockReset()
  tryResolveHostMock.mockReset()
  getApiRequestProfileMock.mockReset()
  getKeepAwakeBridge.mockClear()
  setKeepAwakeBridge.mockClear()
  getApiRequestProfileMock.mockReturnValue('work')
  tryResolveHostMock.mockReturnValue(keepAwakeHost)
})

afterEach(() => {
  desktopWindow.hermesDesktop = initialHermesDesktop
})

describe('keep-awake store', () => {
  it('persists the profile-scoped state confirmed by the backend', async () => {
    hostApiMock.mockResolvedValueOnce({ ok: true, on: true })

    await setKeepAwake(true)
    expect($keepAwake.get()).toBe(true)
    expect(storedBoolean(KEY, false)).toBe(true)
    expect(hostApiMock).toHaveBeenLastCalledWith({
      body: { on: true },
      method: 'POST',
      path: '/api/keep-awake',
      profile: 'work'
    })
    expect(setKeepAwakeBridge).not.toHaveBeenCalled()

    hostApiMock.mockResolvedValueOnce({ ok: true, on: false })
    await setKeepAwake(false)
    expect(storedBoolean(KEY, true)).toBe(false)
  })

  it('rolls back when backend authorization is cancelled', async () => {
    hostApiMock.mockResolvedValueOnce({ ok: false, on: false, error: 'Administrator authorization was cancelled' })

    await setKeepAwake(true)

    expect($keepAwake.get()).toBe(false)
    expect(storedBoolean(KEY, true)).toBe(false)
  })

  it('reconciles persisted renderer state with the profile backend state', async () => {
    $keepAwake.set(true)
    hostApiMock.mockResolvedValueOnce({ ok: true, on: false })

    await refreshKeepAwake()

    expect($keepAwake.get()).toBe(false)
    expect(storedBoolean(KEY, true)).toBe(false)
    expect(hostApiMock).toHaveBeenLastCalledWith({ path: '/api/keep-awake', profile: 'work' })
  })

  it('does not let a stale refresh overwrite newer toolbar intent', async () => {
    let resolveRead!: (result: { ok: boolean; on: boolean }) => void

    hostApiMock.mockReturnValueOnce(new Promise(resolve => (resolveRead = resolve)))
    hostApiMock.mockResolvedValueOnce({ ok: true, on: true })

    const refresh = refreshKeepAwake()

    await setKeepAwake(true)
    resolveRead({ ok: true, on: false })
    await refresh

    expect($keepAwake.get()).toBe(true)
  })

  it('falls back to the native bridge when the backend capability is missing', async () => {
    tryResolveHostMock.mockReturnValue(localOnlyHost)
    setKeepAwakeBridge.mockResolvedValueOnce({ ok: true, on: true })

    await setKeepAwake(true)

    expect($keepAwake.get()).toBe(true)
    expect(hostApiMock).not.toHaveBeenCalled()
    expect(setKeepAwakeBridge).toHaveBeenLastCalledWith(true)
  })
})
