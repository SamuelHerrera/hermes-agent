import { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'

import { onTerminalData } from './persistent-runtime'
import { createHostPlaybackGate } from './use-terminal-session'

describe('createHostPlaybackGate', () => {
  it('forwards real user input while async output is pending but drops parser replies', async () => {
    const term = new Terminal()
    let finishWrite!: () => void
    const gate = createHostPlaybackGate((_data, done) => { finishWrite = done })
    const forwarded: string[] = []
    const subscription = onTerminalData(term, (data, userInput) => {
      if (!gate.isSuppressed(userInput)) { forwarded.push(data) }
    })
    try {
      const pending = gate.writePlayback('output')
      term.input('USER_INPUT', true)
      await new Promise<void>(resolve => term.write('\x1b[6n', resolve))
      expect(forwarded).toEqual(['USER_INPUT'])
      finishWrite()
      await pending
      term.input('AFTER_OUTPUT', true)
      expect(forwarded).toEqual(['USER_INPUT', 'AFTER_OUTPUT'])
    } finally {
      subscription.dispose()
      term.dispose()
    }
  })

  it('suppresses mirror-generated terminal replies during synchronous hydration work only', () => {
    const gate = createHostPlaybackGate(() => {})
    const forwarded: string[] = []
    const onData = (data: string) => {
      if (!gate.isSuppressed()) {
        forwarded.push(data)
      }
    }

    gate.suppress(() => onData('MIRROR_REPLY'))
    onData('pwd\r')

    expect(forwarded).toEqual(['pwd\r'])
  })

  it('keeps live playback suppressed until xterm finishes the write callback', async () => {
    let finishWrite!: () => void
    const write = vi.fn((_data: string, done: () => void) => {
      finishWrite = done
    })
    const gate = createHostPlaybackGate(write)
    const forwarded: string[] = []
    const onData = (data: string) => {
      if (!gate.isSuppressed()) {
        forwarded.push(data)
      }
    }

    const pending = gate.writePlayback('\x1b[6n')
    onData('MIRROR_REPLY')
    expect(forwarded).toEqual([])

    finishWrite()
    await pending
    onData('pwd\r')

    expect(write).toHaveBeenCalledWith('\x1b[6n', expect.any(Function))
    expect(forwarded).toEqual(['pwd\r'])
  })
})
