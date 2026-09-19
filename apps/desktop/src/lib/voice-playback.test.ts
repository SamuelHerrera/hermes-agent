import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HermesConnection } from '@/global'

vi.mock('@/hermes', () => ({
  getApiRequestProfile: vi.fn(() => 'worker'),
  speakText: vi.fn()
}))

const { startSpeechStream, stopVoicePlayback } = await import('./voice-playback')

const originalWebSocket = globalThis.WebSocket

class FakeWebSocket {
  static OPEN = 1
  readyState = 0

  constructor(public url: string) {}

  close() {}
  send() {}
}

afterEach(() => {
  stopVoicePlayback()
  ;(globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket
  delete (window as { hermesDesktop?: unknown }).hermesDesktop
})

describe('voice playback WebSocket routing', () => {
  it('mints the speech stream URL for the requested profile when the descriptor disagrees', async () => {
    const connection: HermesConnection = {
      authMode: 'token',
      baseUrl: 'https://gateway.invalid',
      isFullscreen: false,
      logs: [],
      nativeOverlayWidth: 0,
      profile: 'wrong-profile',
      token: 't',
      windowButtonPosition: null,
      wsUrl: 'wss://gateway.invalid/api/ws?token=t'
    }

    const getConnection = vi.fn(async () => connection)

    const getGatewayWsUrl = vi.fn(async (profile?: null | string) => `wss://gateway.invalid/api/ws?profile=${profile}`)

    ;(globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket
    ;(window as { hermesDesktop?: unknown }).hermesDesktop = { getConnection, getGatewayWsUrl }

    await startSpeechStream({ source: 'voice-conversation' })

    expect(getConnection).toHaveBeenCalledWith('worker')
    expect(getGatewayWsUrl).toHaveBeenCalledWith('worker')
  })
})
