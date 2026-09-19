import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HermesConnection } from '@/global'
import { HermesGateway } from '@/hermes'
import { $gateway } from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState } from '@/store/session'

import { useGatewayRequest } from './use-gateway-request'

const fakeGateway = new HermesGateway()

afterEach(() => {
  $gateway.set(null)
  $activeGatewayProfile.set('default')
  $gatewayState.set('idle')
  delete (window as { hermesDesktop?: unknown }).hermesDesktop
})

describe('useGatewayRequest', () => {
  // The composer's `/` completions only exist when ChatBar receives a non-null
  // gateway PROP. `gatewayRef` is populated by a subscription effect, so it is
  // still null on the first render — a surface that read the ref while
  // rendering (session tiles / ⌘T tabs) shipped `gateway={null}` and silently
  // lost slash completions. The returned `gateway` value must be live
  // immediately so that never happens again.
  it('exposes the live gateway on the first render, before effects run', () => {
    $gateway.set(fakeGateway)

    const { result } = renderHook(() => useGatewayRequest())

    expect(result.current.gateway).toBe(fakeGateway)
  })

  it('tracks the gateway when the active socket changes', () => {
    const { result } = renderHook(() => useGatewayRequest())

    expect(result.current.gateway).toBeNull()

    act(() => $gateway.set(fakeGateway))

    expect(result.current.gateway).toBe(fakeGateway)
  })

  it('mints a reconnect URL for the active profile when the descriptor disagrees', async () => {
    const connection: HermesConnection = {
      authMode: 'token',
      baseUrl: 'https://gateway.invalid',
      isFullscreen: false,
      logs: [],
      nativeOverlayWidth: 0,
      profile: 'wrong-profile',
      token: 't',
      windowButtonPosition: null,
      wsUrl: 'wss://gateway.invalid/api/ws?token=t'
    }

    const getConnection = vi.fn(async () => connection)
    const getGatewayWsUrl = vi.fn(async (profile?: null | string) => `wss://gateway.invalid/${profile}`)

    const gateway = new HermesGateway()

    vi.spyOn(gateway, 'connect').mockResolvedValue(undefined)
    vi.spyOn(gateway, 'request').mockRejectedValueOnce(new Error('not connected')).mockResolvedValueOnce('recovered')

    ;(window as { hermesDesktop?: unknown }).hermesDesktop = { getConnection, getGatewayWsUrl }
    act(() => {
      $activeGatewayProfile.set('worker')
      $gatewayState.set('closed')
      $gateway.set(gateway)
    })
    const { result } = renderHook(() => useGatewayRequest())
    let recovered: unknown

    await act(async () => {
      recovered = await result.current.requestGateway('session.list')
    })

    expect(recovered).toBe('recovered')
    expect(getConnection).toHaveBeenCalledWith('worker')
    expect(getGatewayWsUrl).toHaveBeenCalledWith('worker')
  })
})
