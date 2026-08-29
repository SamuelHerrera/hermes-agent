import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $voicePlayback } from '@/store/voice-playback'

import { VoicePlaybackActivity } from './voice-activity'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      composer: {
        preparingAudio: 'Preparing audio',
        readingAloud: 'Reading aloud',
        speakingResponse: 'Speaking response'
      }
    }
  })
}))

afterEach(() => {
  cleanup()
  $voicePlayback.set({
    audioElement: null,
    messageId: null,
    sequence: 0,
    sessionId: null,
    source: null,
    status: 'idle'
  })
})

describe('VoicePlaybackActivity', () => {
  it('shows playback only in the session that owns it', () => {
    $voicePlayback.set({
      audioElement: null,
      messageId: 'm1',
      sequence: 1,
      sessionId: 'session-a',
      source: 'read-aloud',
      status: 'preparing'
    })

    const { rerender } = render(<VoicePlaybackActivity sessionId="session-b" />)

    expect(screen.queryByText('Preparing audio')).toBeNull()

    rerender(<VoicePlaybackActivity sessionId="session-a" />)

    expect(screen.getByText('Preparing audio')).toBeTruthy()
  })
})
