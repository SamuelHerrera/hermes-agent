import { describe, expect, it, vi } from 'vitest'

import { createHostPlaybackGate } from './use-terminal-session'

describe('createHostPlaybackGate', () => {
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
