import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HermesApiRequest } from '@/global'

import { installHost, resetHostForTests } from './host'
import { hasHostApi, hostApi } from './host-api'
import type { HermesHost } from './types'

afterEach(() => resetHostForTests())

describe('host API transport', () => {
  it('routes renderer REST requests through the installed host', async () => {
    const apiCalls: unknown[] = []

    const api: HermesHost['api'] = async <T>(request: HermesApiRequest): Promise<T> => {
      apiCalls.push(request)

      return { sessions: [] } as T
    }

    const host: HermesHost = {
      kind: 'browser',
      capabilities: {
        backendFiles: false,
        backendGit: false,
        backendLifecycle: false,
        browserClipboard: true,
        browserMicrophone: true,
        browserNotifications: true,
        deepLinkProtocol: false,
        nativeDialogs: false,
        nativeWindows: false,
        persistentTerminal: false,
        revealHostPath: false,
        screenWakeLock: true
      },
      api,
      getConnection: vi.fn(),
      getGatewayWsUrl: vi.fn()
    }

    installHost(host)

    await expect(hostApi({ path: '/api/sessions' })).resolves.toEqual({ sessions: [] })
    expect(apiCalls).toEqual([{ path: '/api/sessions' }])
    expect(hasHostApi()).toBe(true)
  })

  it('reports no API before a host is installed outside Electron', () => {
    expect(hasHostApi()).toBe(false)
  })
})
