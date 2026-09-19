import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesConnection } from '@/global'
import { browserHostCapabilities } from '@/platform/capabilities'
import type { HermesHost } from '@/platform/types'

// The global-remote share (backend routing case 3): every profile is served
// by the PRIMARY backend over one host, and getConnection() explicitly tags
// the shared descriptor with `sharedPrimary`. Dialing a second WebSocket at it
// used to fail over SSH (per-backend tunnel/ticket) and poison the active
// gateway with a closed socket — "Hermes gateway is not connected" for every
// profile except the primary. Pooled backends (own-remote override, local
// named profile) also carry `profile` for WS URL minting, so `profile` alone
// cannot identify the shared-primary route. These tests pin the fix: only a
// `sharedPrimary` descriptor activates the primary socket; a pooled descriptor
// that also carries `profile` must still dial its own socket.

const gatewayMocks = vi.hoisted(() => ({
  connect: vi.fn(async (_wsUrl: string): Promise<void> => {
    throw new Error('dialed a socket for a shared-primary profile')
  })
}))

vi.mock('@/hermes', () => ({
  HermesGateway: class {
    connectionState = 'closed'
    connect = gatewayMocks.connect
    onEvent = vi.fn(() => () => {})
    onState = vi.fn(() => () => {})
  }
}))
vi.mock('@/store/session', () => ({ setGatewayState: vi.fn() }))
vi.mock('@/store/notify-baseline', () => ({ markNativeNotifyBaseline: vi.fn() }))

const { HermesGateway } = await import('@/hermes')
const { installHost, resetHostForTests } = await import('@/platform/host')

const { $gateway, backgroundGatewayForProfile, configureGatewayRegistry, ensureGatewayForProfile, setPrimaryGateway } =
  await import('./gateway')

type DesktopStub = Pick<HermesHost, 'getConnection'>

function makeConnection(overrides: Partial<HermesConnection> = {}): HermesConnection {
  return {
    baseUrl: 'http://127.0.0.1:4242',
    isFullscreen: false,
    logs: [],
    nativeOverlayWidth: 0,
    token: 't',
    windowButtonPosition: null,
    wsUrl: 'ws://127.0.0.1:4242/api/ws?token=t',
    ...overrides
  }
}

function installDesktop(stub: DesktopStub): void {
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
    ...stub,
    getGatewayWsUrl: vi.fn(async (profile?: null | string) => (await stub.getConnection(profile)).wsUrl),
    api: vi.fn()
  }
}

function installBrowserHost(stub: DesktopStub): HermesHost {
  const host: HermesHost = {
    ...stub,
    api: vi.fn(),
    capabilities: browserHostCapabilities(),
    getGatewayWsUrl: vi.fn(async profile => `wss://gateway.invalid/${profile}`),
    kind: 'browser'
  }

  installHost(host)

  return host
}

function makePrimary() {
  const gateway = new HermesGateway()
  Object.defineProperty(gateway, 'connectionState', { value: 'open' })

  return gateway
}

beforeEach(() => {
  resetHostForTests()
  configureGatewayRegistry({ onEvent: vi.fn() })
})

afterEach(() => {
  vi.clearAllMocks()
  resetHostForTests()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('ensureGatewayForProfile under a shared global remote', () => {
  it('scopes a background request without changing the foreground socket', async () => {
    const primary = makePrimary()
    setPrimaryGateway(primary, 'default')
    const foreground = $gateway.get()
    installBrowserHost({
      getConnection: vi.fn(async () => makeConnection({ profile: 'background', sharedPrimary: true }))
    })

    const route = await backgroundGatewayForProfile('background')

    expect(route.gateway).toBe(primary)
    expect(route.params).toEqual({ profile: 'background' })
    expect($gateway.get()).toBe(foreground)
    expect(gatewayMocks.connect).not.toHaveBeenCalled()
  })

  it('fails closed rather than sending a background request to the primary on a dial failure', async () => {
    const primary = makePrimary()
    setPrimaryGateway(primary, 'default')
    const foreground = $gateway.get()
    installDesktop({
      getConnection: vi.fn(async () =>
        makeConnection({
          authMode: 'token',
          baseUrl: 'https://isolated.invalid',
          mode: 'remote',
          profile: 'unreachable',
          wsUrl: 'wss://isolated.invalid/api/ws'
        })
      )
    })

    await expect(backgroundGatewayForProfile('unreachable')).rejects.toThrow()
    expect($gateway.get()).toBe(foreground)
  })

  it('activates the primary socket for an explicitly shared-primary descriptor', async () => {
    const primary = makePrimary()
    setPrimaryGateway(primary, 'default')
    installDesktop({
      // Shared descriptor: primary connection tagged with the profile scope
      // AND the explicit sharedPrimary marker.
      getConnection: vi.fn(async () => makeConnection({ profile: 'venture', sharedPrimary: true }))
    })

    await ensureGatewayForProfile('venture')

    expect(gatewayMocks.connect).not.toHaveBeenCalled()
    expect($gateway.get()).toBe(primary)
  })

  it('mints a secondary WebSocket URL for the requested profile rather than the descriptor profile', async () => {
    const primary = makePrimary()

    setPrimaryGateway(primary, 'default')

    const host = installBrowserHost({
      // A stale or older adapter may omit or mismatch this metadata. The
      // requested route remains authoritative for URL minting.
      getConnection: vi.fn(async () =>
        makeConnection({
          authMode: 'token',
          baseUrl: 'https://remote.invalid',
          mode: 'remote',
          profile: 'wrong-profile',
          token: 'fake-test-token',
          wsUrl: 'wss://remote.invalid/api/ws?token=fake-test-token'
        })
      )
    })

    gatewayMocks.connect.mockResolvedValueOnce(undefined)

    await ensureGatewayForProfile('worker')

    expect(gatewayMocks.connect).toHaveBeenCalledOnce()
    expect(host.getGatewayWsUrl).toHaveBeenCalledWith('worker')
    expect($gateway.get()).not.toBe(primary)
  })
})
