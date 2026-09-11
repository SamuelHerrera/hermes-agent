import { afterEach, describe, expect, it, vi } from 'vitest'

import { openRemoteTerminal } from './remote-terminal'
import { createTerminalDelivery } from './terminal-delivery'

class Socket extends EventTarget {
  static last: Socket
  readyState = 1
  binaryType = ''
  sent: string[] = []
  constructor(readonly url: string) {
    super()
    Socket.last = this
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    if (this.readyState === 3) {
      return
    }

    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
  frame(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}
const impl = Socket as unknown as typeof WebSocket

afterEach(() => vi.useRealTimers())

describe('remote shell transport', () => {
  it('keeps I/O bound to the original socket, decodes split UTF-8 and closes it', async () => {
    const pending = openRemoteTerminal('ws://owner-A/api/terminal?token=test', impl)
    const a = Socket.last
    a.frame(JSON.stringify({ type: 'ready', protocol: 1 }))
    const terminal = await pending
    const b = new Socket('ws://owner-B/api/terminal')
    const received: string[] = []
    terminal.onData(data => received.push(data))
    const bytes = new TextEncoder().encode('€')
    a.frame(bytes.slice(0, 1).buffer)
    a.frame(bytes.slice(1).buffer)
    terminal.write('pwd\r')
    terminal.resize(100, 30)
    expect(received.join('')).toBe('€')
    expect(a.sent).toEqual(['pwd\r', '\x1b[RESIZE:100;30]'])
    expect(b.sent).toEqual([])
    const exit = vi.fn()
    terminal.onExit(exit)
    terminal.kill()
    expect(a.readyState).toBe(3)
    expect(b.readyState).toBe(1)
    expect(exit).toHaveBeenCalledOnce()
  })

  it.each(['old backend', 'auth rejected'])('fails closed on %s', async () => {
    const pending = openRemoteTerminal('ws://owner-A/api/terminal', impl)
    Socket.last.close()
    await expect(pending).rejects.toThrow('owner backend')
  })

  it('requires the shell protocol, not an HTTP upgrade or TUI output', async () => {
    const pending = openRemoteTerminal('ws://owner-A/api/terminal', impl)
    Socket.last.frame('a shell prompt from the wrong endpoint')
    await expect(pending).rejects.toThrow('owner backend')
    expect(Socket.last.readyState).toBe(3)
  })

  it('bounds a backend that upgrades but never becomes ready', async () => {
    vi.useFakeTimers()
    const pending = openRemoteTerminal('ws://owner-A/api/terminal', impl)
    const rejected = expect(pending).rejects.toThrow('owner backend')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
  })
})

it('retains socket output and immediate exit across start completion until renderer attachment', async () => {
  const pending = openRemoteTerminal('ws://owner-A/api/terminal', impl)
  Socket.last.frame(JSON.stringify({ type: 'ready', protocol: 1 }))
  Socket.last.frame('INITIAL_PROMPT')
  Socket.last.close()
  const terminal = await pending
  const delivered = vi.fn()
  const delivery = createTerminalDelivery(delivered)
  terminal.onData(data => delivery.send('data', data))
  terminal.onExit(exit => delivery.send('exit', exit))
  expect(delivered).not.toHaveBeenCalled()
  delivery.attach()
  delivery.attach()
  expect(delivered.mock.calls).toEqual([
    ['data', 'INITIAL_PROMPT'],
    ['exit', { exitCode: 0, signal: 0 }]
  ])
})
