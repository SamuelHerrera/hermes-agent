import { afterEach, describe, expect, it, vi } from 'vitest'

import { installHost, resetHostForTests } from './host'
import { resetTerminalApiForTests, terminalApi } from './terminal'

const capabilities = {
  backendFiles: false,
  backendGit: false,
  backendLifecycle: false,
  browserClipboard: false,
  browserMicrophone: false,
  browserNotifications: false,
  deepLinkProtocol: false,
  globalHotkeys: false,
  nativeDialogs: false,
  nativeWindows: false,
  persistentTerminal: false,
  revealHostPath: false,
  screenWakeLock: false,
  windowBelow: false
}

describe('terminal host adapter', () => {
  afterEach(() => {
    resetTerminalApiForTests()
    resetHostForTests()
    vi.unstubAllGlobals()
  })

  it('keeps Electron native operations and adds backend-shared tab operations', () => {
    const native = { persistent: true }
    vi.stubGlobal('window', { hermesDesktop: { terminal: native } })
    const api = terminalApi()

    expect(api?.persistent).toBe(true)
    expect(api?.list).toEqual(expect.any(Function))
    expect(api?.updateShared).toEqual(expect.any(Function))
  })

  it('returns no terminal when a browser backend did not advertise persistence', () => {
    vi.stubGlobal('window', {})
    installHost({ kind: 'browser', capabilities, api: vi.fn(), getConnection: vi.fn(), getGatewayWsUrl: vi.fn() })
    expect(terminalApi()).toBeUndefined()
  })

  it('installs the browser transport only for an advertised browser capability', () => {
    vi.stubGlobal('window', {})
    installHost({ kind: 'browser', capabilities: { ...capabilities, persistentTerminal: true }, api: vi.fn(), getConnection: vi.fn(), getGatewayWsUrl: vi.fn() })
    expect(terminalApi()?.persistent).toBe(true)
  })
})
