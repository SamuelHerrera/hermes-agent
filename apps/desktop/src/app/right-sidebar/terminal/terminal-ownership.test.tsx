import { act, render, waitFor } from '@testing-library/react'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'

import mainSource from '../../../../electron/main.ts?raw'
import preloadSource from '../../../../electron/preload.ts?raw'
import deliverySource from '../../../../electron/terminal-delivery.ts?raw'

import { TerminalInstance } from './instance'
import { closeTerminal } from './terminals'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), input: (_data: string) => {}, write: vi.fn() }))
const disposable = () => ({ dispose: vi.fn() })
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    unicode = { activeVersion: '11' }
    parser = { registerOscHandler: disposable }
    options: Record<string, unknown>
    constructor(options: Record<string, unknown>) {
      this.options = options
    }
    onData(callback: (data: string) => void) {
      mocks.input = callback

      return disposable()
    }
    onSelectionChange = disposable
    onTitleChange = disposable
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {}
    focus() {}
    clearSelection() {}
    hasSelection() {
      return false
    }
    getSelection() {
      return ''
    }
    write = mocks.write
    dispose() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  }
}))
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {
    serialize() {
      return ''
    }
  }
}))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss() {}
    clearTextureAtlas() {}
  }
}))
vi.mock('./links', () => ({ terminalLinkHandler: {}, terminalWebLinksAddon: () => ({}) }))
vi.mock('./terminal-font', () => ({ prepareTerminalFontFamily: mocks.prepare }))
vi.mock('./use-terminal-font', async () => {
  const { useRef } = await import('react')

  return { useTerminalFontController: () => ({ latestFontFamilyRef: useRef('monospace'), mountedRef: useRef(false) }) }
})
vi.mock('@/themes/context', () => ({ useTheme: () => ({ renderedMode: 'dark', theme: {}, themeName: 'test' }) }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: {} }) }))
vi.mock('./buffer', () => ({ makeTerminalReader: vi.fn(), registerTerminalReader: () => vi.fn() }))
vi.mock('./terminals', () => ({
  closeTerminal: vi.fn(),
  reportTerminalShell: vi.fn(),
  updateTerminalRestoreCwd: vi.fn(),
  updateTerminalReviveBuffer: vi.fn()
}))

afterEach(() => {
  vi.clearAllMocks()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('passes the immutable restored owner through instance and font await to spawn, then uses only the session handle', async () => {
  let fontsReady!: (font: string) => void
  mocks.prepare.mockReturnValue(
    new Promise<string>(resolve => {
      fontsReady = resolve
    })
  )

  const api = {
    attach: vi.fn(async () => true),
    start: vi.fn(async () => ({ id: 'owner-A-session', shell: 'shell' })),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: () => vi.fn(),
    onExit: () => vi.fn()
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { terminal: api } })

  const props = {
    active: false,
    id: 'restored-A',
    cwd: '/launch',
    restoreCwd: '/restored',
    onAddSelectionToChat: vi.fn()
  }

  const { rerender, unmount } = render(<TerminalInstance {...props} profile="A" />)
  rerender(<TerminalInstance {...props} profile="B" />)
  await act(async () => {
    fontsReady('monospace')
  })
  await waitFor(() => expect(api.start).toHaveBeenCalledWith({ profile: 'A', cols: 80, rows: 24, cwd: '/restored' }))
  act(() => mocks.input('pwd\r'))
  expect(api.write).toHaveBeenCalledWith('owner-A-session', 'pwd\r')
  expect(api.start).toHaveBeenCalledOnce()
  unmount()
  expect(api.dispose).toHaveBeenCalledWith('owner-A-session')
})

const ipc = vi.hoisted(() => ({
  bridge: {} as Record<string, any>,
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => void>(),
  sender: { id: 1, isDestroyed: (): boolean => false, once: vi.fn(), send: vi.fn() }
}))

const electronMock = {
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => {
      ipc.bridge[name] = value
    }
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!({ sender: ipc.sender }, ...args),
    on: (channel: string, listener: (...args: any[]) => void) => ipc.listeners.set(channel, listener),
    removeListener: (channel: string) => ipc.listeners.delete(channel)
  },
  webUtils: {}
}

async function installTerminalIpc(open: () => Promise<unknown>) {
  ipc.handlers.clear()
  ipc.listeners.clear()
  ipc.sender.isDestroyed = () => false
  ipc.sender.send.mockImplementation((channel, payload) => ipc.listeners.get(channel)?.({}, payload))
  const sessions = new Map()
  const start = mainSource.indexOf("ipcMain.handle('hermes:terminal:start'")
  const end = mainSource.indexOf("ipcMain.handle('hermes:updates:check'", start)

  const bindings = {
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => ipc.handlers.set(name, handler) },
    resolveTerminalRoute: async () => ({
      kind: 'remote',
      profile: 'A',
      connection: { authMode: 'token', wsUrl: 'ws://owner-A/api/ws?token=test', source: 'profile' }
    }),
    resolveRemoteBackend: vi.fn(),
    sshConnections: new Map(),
    crypto: { randomUUID: () => 'session-A' },
    terminalShellCommand: () => ({ command: 'shell', args: [], name: 'shell' }),
    safeTerminalCwd: () => '/home',
    openRemoteTerminal: open,
    createTerminalDelivery: new Function(
      ts.transpile(deliverySource.replace('export ', '')) + '; return createTerminalDelivery'
    )(),
    terminalSessions: sessions,
    terminalChannel: (id: string, kind: string) => `hermes:terminal:${id}:${kind}`,
    disposeTerminalSession: (id: string) => {
      sessions.get(id)?.pty.kill()

      return sessions.delete(id)
    },
    nodePty: {
      spawn: () => {
        throw new Error('unexpected local spawn')
      }
    }
  }

  new Function(...Object.keys(bindings), mainSource.slice(start, end))(...Object.values(bindings))
  new Function(...Object.keys(electronMock), ts.transpile(preloadSource.replace(/^import .*from 'electron'\n/, '')))(
    ...Object.values(electronMock)
  )
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: ipc.bridge.hermesDesktop })

  return sessions
}

it('delivers initial prompt and immediate exit through main, preload and renderer after subscriptions', async () => {
  const sessions = await installTerminalIpc(async () => ({
    onData: (listener: (data: string) => void) => listener('INITIAL_PROMPT'),
    onExit: (listener: (exit: unknown) => void) => listener({ exitCode: 0, signal: 0 }),
    kill: vi.fn()
  }))

  mocks.prepare.mockResolvedValue('monospace')

  const { unmount } = render(
    <TerminalInstance active={false} cwd="" id="early-exit" onAddSelectionToChat={vi.fn()} profile="A" />
  )

  await waitFor(() => expect(closeTerminal).toHaveBeenCalledWith('early-exit'))
  expect(mocks.write.mock.calls.some(([data]) => String(data).includes('INITIAL_PROMPT'))).toBe(true)
  expect(sessions.size).toBe(0)
  expect(ipc.sender.send.mock.calls.map(([channel]) => channel)).toEqual([
    'hermes:terminal:session-A:data',
    'hermes:terminal:session-A:exit'
  ])
  unmount()
})

it('cleans up pending destroyed owners and rejects cross-window attach and I/O', async () => {
  let resolve!: (value: unknown) => void
  const remote = { kill: vi.fn(), write: vi.fn(), resize: vi.fn(), onData: vi.fn(), onExit: vi.fn() }

  const sessions = await installTerminalIpc(
    () =>
      new Promise(done => {
        resolve = done
      })
  )

  const start = ipc.handlers.get('hermes:terminal:start')!({ sender: ipc.sender }, { profile: 'A' })
  await waitFor(() => expect(resolve).toBeDefined())
  ipc.sender.isDestroyed = () => true
  resolve(remote)
  await expect(start).rejects.toThrow('Terminal window closed')
  expect(remote.kill).toHaveBeenCalledOnce()
  expect(sessions.size).toBe(0)
  const delivery = { attach: vi.fn() }
  sessions.set('owned', { webContentsId: 1, pty: remote, delivery })

  for (const action of ['attach', 'write', 'resize', 'dispose']) {
    expect(await ipc.handlers.get(`hermes:terminal:${action}`)!({ sender: { id: 2 } }, 'owned', 'x')).toBe(false)
  }

  expect(delivery.attach).not.toHaveBeenCalled()
  expect(remote.write).not.toHaveBeenCalled()
  expect(remote.resize).not.toHaveBeenCalled()
  expect(sessions.has('owned')).toBe(true)
})

it('surfaces remote startup failure without spawning a local PTY', async () => {
  const sessions = await installTerminalIpc(async () => {
    throw new Error('Remote terminal unavailable')
  })

  await expect(ipc.handlers.get('hermes:terminal:start')!({ sender: ipc.sender }, { profile: 'A' })).rejects.toThrow(
    'Remote terminal unavailable'
  )
  expect(sessions.size).toBe(0)
})

it('does not remove remembered terminal tabs when app quit disposes the PTY before pagehide', async () => {
  let fontsReady!: (font: string) => void
  let exitCallback!: () => void
  let windowStateCallback!: (payload: { isQuitting?: boolean }) => void
  mocks.prepare.mockReturnValue(
    new Promise<string>(resolve => {
      fontsReady = resolve
    })
  )

  const api = {
    attach: vi.fn(async () => true),
    start: vi.fn(async () => ({ id: 'quit-session', shell: 'shell' })),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: () => vi.fn(),
    onExit: vi.fn((_id: string, callback: () => void) => {
      exitCallback = callback

      return vi.fn()
    })
  }

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      onWindowStateChanged: vi.fn(callback => {
        windowStateCallback = callback

        return vi.fn()
      }),
      terminal: api
    }
  })

  const { unmount } = render(<TerminalInstance active={false} cwd="" id="keep-tab" onAddSelectionToChat={vi.fn()} />)
  await act(async () => {
    fontsReady('monospace')
  })

  await waitFor(() => expect(api.onExit).toHaveBeenCalled())
  act(() => windowStateCallback({ isQuitting: true }))
  act(() => exitCallback())

  expect(closeTerminal).not.toHaveBeenCalledWith('keep-tab')
  unmount()
})
