import { afterEach, describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import { setSessions } from './session'
import { $sessionDotStateById, hasLiveTurn, showsRunningArc } from './session-dot-state'
import { clearAllSessionStates } from './session-states'

const session = (over: Partial<SessionInfo>): SessionInfo => ({
  archived: false,
  cwd: null,
  ended_at: null,
  id: 's1',
  input_tokens: 0,
  is_active: false,
  last_active: 0,
  message_count: 1,
  model: null,
  output_tokens: 0,
  preview: null,
  source: 'cli',
  started_at: 0,
  title: 'Running elsewhere',
  tool_call_count: 0,
  ...over
})

afterEach(() => {
  clearAllSessionStates()
  setSessions([])
})

describe('showsRunningArc', () => {
  it('keeps the arc when an authoritative turn goes quiet', () => {
    expect(showsRunningArc('working')).toBe(true)
    expect(showsRunningArc('stalled')).toBe(true)
  })

  it('yields to the needs-input treatment rather than running both', () => {
    expect(showsRunningArc('needs-input')).toBe(false)
  })

  it('leaves a session that is not running unmarked', () => {
    expect(showsRunningArc('background')).toBe(false)
    expect(showsRunningArc('idle')).toBe(false)
    expect(showsRunningArc('unread')).toBe(false)
  })
})

describe('hasLiveTurn', () => {
  it('counts a turn waiting on an answer as still live', () => {
    expect(hasLiveTurn('needs-input')).toBe(true)
  })

  it('covers everything the arc covers', () => {
    for (const state of ['background', 'idle', 'needs-input', 'stalled', 'unread', 'working'] as const) {
      expect(hasLiveTurn(state) || !showsRunningArc(state)).toBe(true)
    }
  })

  it('excludes work that outlived the turn', () => {
    expect(hasLiveTurn('background')).toBe(false)
    expect(hasLiveTurn('unread')).toBe(false)
  })
})

describe('$sessionDotStateById external running rows', () => {
  it('uses the REST running hint when no local runtime state exists', () => {
    setSessions([session({ id: 'external-cli', running: true })])

    expect($sessionDotStateById.get()['external-cli']).toBe('working')
  })

  it('does not promote a merely recent inactive row', () => {
    setSessions([session({ id: 'recent-idle', is_active: true, running: false })])

    expect($sessionDotStateById.get()['recent-idle']).toBeUndefined()
  })
})
