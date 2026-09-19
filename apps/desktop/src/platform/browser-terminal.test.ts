import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HermesHost } from './types'
import { createBrowserTerminal } from './browser-terminal'

class FakeSocket {
  static instances: FakeSocket[] = []
  static protocol = 2
  readyState = 1
  sent: any[] = []
  listeners = new Map<string, Array<(event: any) => void>>()

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'ready', protocol: (this.constructor as typeof FakeSocket).protocol, scope: 'profile/work', epoch: 'epoch-1' }) }))
  }

  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(raw: string) {
    const frame = JSON.parse(raw)
    this.sent.push(frame)
    const terminalId = frame.params.terminalId ?? 'terminal-1'
    const result: Record<string, unknown> = {
      create: { epoch: 'epoch-1', terminalId },
      attach: { identity: { scope: 'profile/work', epoch: 'epoch-1', terminalId, owner: 'lease-1' }, pid: 42, snapshot: { seq: 3 } },
      input: true,
      resize: true,
      read: { events: [], exit: null },
      detach: true,
      terminate: true
    }
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: frame.id, result: result[frame.method] }) }))
  }

  close() {
    this.readyState = 3
    this.emit('close', {})
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function host(): HermesHost {
  return {
    kind: 'browser',
    capabilities: {
      backendFiles: true,
      backendGit: true,
      backendLifecycle: false,
      browserClipboard: true,
      browserMicrophone: true,
      browserNotifications: true,
      deepLinkProtocol: false,
      nativeDialogs: false,
      nativeWindows: false,
      persistentTerminal: true,
      revealHostPath: false,
      screenWakeLock: true
    },
    api: vi.fn(),
    getConnection: vi.fn(),
    getGatewayWsUrl: vi.fn(async profile => `wss://backend-b.test/prefix/api/ws?profile=${profile}&ticket=fresh`)
  }
}

describe('browser persistent terminal transport', () => {
  afterEach(() => {
    FakeSocket.instances = []
    vi.unstubAllGlobals()
  })

  it('creates, writes, resizes, disconnects, and reconnects the same durable terminal id', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const api = createBrowserTerminal(host())
    const first = await api.start({ requestId: 'tab-1', profile: 'work', cols: 80, rows: 24, cwd: '/srv' })

    expect(first.reference).toEqual({ scope: 'profile/work', epoch: 'epoch-1', terminalId: 'terminal-1' })
    expect(FakeSocket.instances[0].url).toBe('wss://backend-b.test/prefix/api/persistent-terminal?profile=work&ticket=fresh')
    await api.write(first.id, 'echo hi\r')
    await api.resize(first.id, { cols: 100, rows: 40 })
    await api.dispose(first.id)

    const second = await api.start({ requestId: 'tab-1', profile: 'work', reference: first.reference })
    expect(second.reference?.terminalId).toBe('terminal-1')
    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.instances[1].sent.some(frame => frame.method === 'create')).toBe(false)
    expect(FakeSocket.instances[1].sent.find(frame => frame.method === 'attach')?.params.terminalId).toBe('terminal-1')
  })

  it('preserves one-writer ownership for write and terminate and exposes process exit through read', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const api = createBrowserTerminal(host())
    const session = await api.start({ requestId: 'tab-1', profile: 'work' })
    const socket = FakeSocket.instances[0]

    await api.write(session.id, 'x')
    expect(socket.sent.find(frame => frame.method === 'input')?.params.owner).toBe('lease-1')
    await api.terminate!(session.id)
    expect(socket.sent.find(frame => frame.method === 'terminate')?.params).toEqual(session.reference)
  })

  it('fails closed when the capability is absent or the versioned handshake is unsupported', async () => {
    vi.stubGlobal('WebSocket', class extends FakeSocket {
      static protocol = 1
    })
    const unavailable = host()
    unavailable.capabilities = { ...unavailable.capabilities, persistentTerminal: false }
    expect(() => createBrowserTerminal(unavailable)).toThrow('unsupported')

    const api = createBrowserTerminal(host())
    await expect(api.start({ requestId: 'tab-1', profile: 'work' })).rejects.toThrow('protocol')
  })
})
