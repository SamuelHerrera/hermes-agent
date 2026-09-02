import { describe, expect, it } from 'vitest'

import { chromeBridgeHealthState } from './chrome-bridge-health'

describe('Chrome bridge health', () => {
  it('distinguishes the MCP process from the authorized Chrome connection', () => {
    expect(chromeBridgeHealthState({
      ok: true,
      tools: [],
      health: { chromeBridge: { bridgeConnected: true, nativeConnected: true } }
    })).toBe('connected')
    expect(chromeBridgeHealthState({
      ok: true,
      tools: [],
      health: { chromeBridge: { connected: false } }
    })).toBe('disconnected')
    expect(chromeBridgeHealthState({ ok: true, tools: [] })).toBeNull()
    expect(chromeBridgeHealthState({ ok: false, tools: [], error: 'spawn failed' })).toBeNull()
  })
})
