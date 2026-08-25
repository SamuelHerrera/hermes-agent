import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $sessions } from '@/store/session'
import {
  $attentionSessionIds,
  $stalledSessionIds,
  $workingSessionIds,
  clearAllSessionStates,
  SESSION_WATCHDOG_TIMEOUT_MS
} from '@/store/session-states'
import { $subagentsBySession, subagentStoreRevision, upsertSubagent } from '@/store/subagents'
import type { SessionInfo } from '@/types/hermes'

import { rehydrateActiveSubagentStatuses, rehydrateLiveSessionStatuses } from './use-background-sync'

describe('rehydrateLiveSessionStatuses', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    clearAllSessionStates()
    $sessions.set([])
    $subagentsBySession.set({})
  })

  it('restores running sessions after reconnect without opening them', () => {
    const now = 1_800_000_000_000

    rehydrateLiveSessionStatuses(
      {
        sessions: [
          {
            id: 'runtime-overnight',
            last_active: (now - SESSION_WATCHDOG_TIMEOUT_MS - 1_000) / 1000,
            session_key: 'overnight-exam-learning',
            status: 'working'
          },
          {
            id: 'runtime-cleanup',
            last_active: now / 1000,
            session_key: 'temporary-file-cleanup',
            status: 'working'
          }
        ]
      },
      now
    )

    expect($workingSessionIds.get()).toEqual(['overnight-exam-learning', 'temporary-file-cleanup'])
    expect($stalledSessionIds.get()).toEqual(['overnight-exam-learning'])
    expect($attentionSessionIds.get()).toEqual([])
  })

  it('restores a waiting turn as working and needing attention', () => {
    rehydrateLiveSessionStatuses({
      sessions: [{ id: 'runtime-needs-user', session_key: 'needs-user', status: 'waiting' }]
    })

    expect($workingSessionIds.get()).toEqual(['needs-user'])
    expect($attentionSessionIds.get()).toEqual(['needs-user'])
    expect($stalledSessionIds.get()).toEqual([])
  })

  it('ignores idle, starting, and malformed live-session rows', () => {
    rehydrateLiveSessionStatuses({
      sessions: [
        { id: 'runtime-idle', session_key: 'idle-session', status: 'idle' },
        { id: 'runtime-starting', session_key: 'starting-session', status: 'starting' },
        { id: 'runtime-malformed', status: 'working' }
      ]
    })

    expect($workingSessionIds.get()).toEqual([])
    expect($attentionSessionIds.get()).toEqual([])
    expect($stalledSessionIds.get()).toEqual([])
  })

  it('rehydrates the agents toolbar after live parent sessions are restored', () => {
    rehydrateLiveSessionStatuses({
      sessions: [{ id: 'parent-runtime', session_key: 'parent-stored', status: 'working' }]
    })

    rehydrateActiveSubagentStatuses({
      active: [
        {
          child_session_id: 'child-stored',
          goal: 'continue detached work',
          parent_session_id: 'parent-stored',
          status: 'running',
          subagent_id: 'child-1'
        }
      ]
    })

    expect($subagentsBySession.get()['parent-runtime']).toEqual([
      expect.objectContaining({ id: 'child-1', parentSessionId: 'parent-stored', sessionId: 'child-stored' })
    ])
  })

  it('reconciles only the active gateway profile', () => {
    const session = (id: string, profile: string): SessionInfo => ({
      ended_at: null,
      id,
      input_tokens: 0,
      is_active: true,
      last_active: 1,
      message_count: 0,
      model: null,
      output_tokens: 0,
      preview: null,
      profile,
      source: 'desktop',
      started_at: 1,
      title: id,
      tool_call_count: 0
    })

    $sessions.set([session('parent-default', 'default'), session('parent-work', 'work')])
    rehydrateLiveSessionStatuses({
      sessions: [
        { id: 'runtime-default', session_key: 'parent-default', status: 'working' },
        { id: 'runtime-work', session_key: 'parent-work', status: 'working' }
      ]
    })
    upsertSubagent('runtime-default', {
      child_session_id: 'child-default',
      parent_session_id: 'parent-default',
      profile: 'default',
      status: 'running',
      subagent_id: 'default-agent'
    })
    upsertSubagent('runtime-work', {
      child_session_id: 'child-work',
      parent_session_id: 'parent-work',
      profile: 'work',
      status: 'running',
      subagent_id: 'work-agent'
    })

    rehydrateActiveSubagentStatuses({ active: [] }, 'default')

    expect($subagentsBySession.get()['runtime-default']).toBeUndefined()
    expect($subagentsBySession.get()['runtime-work']).toEqual([
      expect.objectContaining({ id: 'work-agent', profile: 'work', status: 'running' })
    ])
  })

  it('rejects a stale snapshot when a newer stream event landed during the request', () => {
    const requestRevision = subagentStoreRevision()

    upsertSubagent('parent-runtime', {
      child_session_id: 'new-child',
      parent_session_id: 'parent-stored',
      profile: 'default',
      status: 'running',
      subagent_id: 'new-agent'
    })

    expect(rehydrateActiveSubagentStatuses({ active: [] }, 'default', requestRevision)).toBe(false)
    expect($subagentsBySession.get()['parent-runtime']).toEqual([
      expect.objectContaining({ id: 'new-agent', status: 'running' })
    ])
  })
})
