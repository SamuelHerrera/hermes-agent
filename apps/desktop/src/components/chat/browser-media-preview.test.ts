import { afterEach, describe, expect, it, vi } from 'vitest'

import { installHost, resetHostForTests } from '@/platform/host'
import type { HermesHost } from '@/platform/types'
import { $connection } from '@/store/session'

import { resolveDirectiveImageSrc } from '../assistant-ui/directive-text'

import { resolveGeneratedImageSrc } from './generated-image-result'

const DATA_URL = 'data:image/png;base64,Ynl0ZXM='

function installBrowserHost() {
  const api = vi.fn(async () => ({ dataUrl: DATA_URL }))
  installHost({
    kind: 'browser',
    capabilities: {} as HermesHost['capabilities'],
    api: api as HermesHost['api'],
    getConnection: vi.fn(),
    getGatewayWsUrl: vi.fn()
  })
  Reflect.deleteProperty(window, 'hermesDesktop')
  $connection.set({ mode: 'remote', profile: 'browser-profile' } as never)

  return api
}

afterEach(() => {
  resetHostForTests()
  $connection.set(null)
  vi.clearAllMocks()
})

describe('browser media preview call sites', () => {
  it('loads generated images through the installed browser host', async () => {
    const api = installBrowserHost()

    await expect(resolveGeneratedImageSrc('/srv/generated.png')).resolves.toBe(DATA_URL)
    expect(api).toHaveBeenCalledWith({
      path: '/api/fs/read-data-url?path=%2Fsrv%2Fgenerated.png',
      profile: 'browser-profile'
    })
  })

  it('loads directive images through the installed browser host', async () => {
    const api = installBrowserHost()

    await expect(resolveDirectiveImageSrc('/srv/reference.png')).resolves.toBe(DATA_URL)
    expect(api).toHaveBeenCalledWith({
      path: '/api/fs/read-data-url?path=%2Fsrv%2Freference.png',
      profile: 'browser-profile'
    })
  })
})
