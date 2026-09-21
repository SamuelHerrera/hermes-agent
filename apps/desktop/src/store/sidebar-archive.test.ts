import { afterEach, describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import { $sessions } from './session'
import { removeArchivedSessionRows } from './sidebar-archive'

const session = (over: Partial<SessionInfo>): SessionInfo => ({
  archived: false,
  cwd: null,
  ended_at: null,
  id: 'live',
  input_tokens: 0,
  is_active: false,
  last_active: 0,
  message_count: 0,
  model: null,
  output_tokens: 0,
  preview: null,
  source: null,
  started_at: 0,
  title: null,
  tool_call_count: 0,
  ...over
})

describe('removeArchivedSessionRows', () => {
  afterEach(() => {
    $sessions.set([])
  })

  it('evicts a backend-confirmed archive even when the cached row is still active', () => {
    $sessions.set([
      session({ _lineage_root_id: 'root', id: 'tip', is_active: true, profile: 'default' }),
      session({ id: 'other', profile: 'default' })
    ])

    removeArchivedSessionRows(['root'], 'default')

    expect($sessions.get().map(row => row.id)).toEqual(['other'])
  })

  it('does not evict a same-id row owned by another profile', () => {
    $sessions.set([
      session({ id: 'shared-id', profile: 'default' }),
      session({ id: 'shared-id', profile: 'work' })
    ])

    removeArchivedSessionRows(['shared-id'], 'work')

    expect($sessions.get().map(row => row.profile)).toEqual(['default'])
  })
})