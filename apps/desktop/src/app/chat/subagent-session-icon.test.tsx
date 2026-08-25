import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'
import { $subagentsBySession, upsertSubagent } from '@/store/subagents'
import type { SessionInfo } from '@/types/hermes'

import { SessionTabLead } from './subagent-session-icon'

afterEach(() => {
  clearAllSessionStates()
  $subagentsBySession.set({})
})

describe('SessionTabLead subagent indicator', () => {
  it('uses one robot at rest and swaps it for exactly one spinner while running', () => {
    const session = { delegate_parent_session_id: 'parent', source: 'delegate' } as SessionInfo
    const { container } = render(<SessionTabLead session={session} storedSessionId="s1" />)

    expect(container.querySelectorAll('.codicon-robot')).toHaveLength(1)
    expect(container.querySelectorAll('.codicon-loading.codicon-modifier-spin')).toHaveLength(0)

    act(() => {
      publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })
    })

    expect(container.querySelectorAll('.codicon-robot')).toHaveLength(0)
    expect(container.querySelectorAll('.codicon-loading.codicon-modifier-spin')).toHaveLength(1)

    act(() => {
      clearAllSessionStates()
    })

    expect(container.querySelectorAll('.codicon-robot')).toHaveLength(1)
    expect(container.querySelectorAll('.codicon-loading.codicon-modifier-spin')).toHaveLength(0)
  })

  it('shows the loading spinner from a hydrated active-subagent snapshot', () => {
    const session = { delegate_parent_session_id: 'parent', source: 'subagent' } as SessionInfo

    act(() => {
      upsertSubagent('parent-runtime', {
        child_session_id: 'child-stored',
        goal: 'Keep working',
        status: 'running',
        subagent_id: 'child-1'
      })
    })

    const { container } = render(<SessionTabLead session={session} storedSessionId="child-stored" />)

    expect(container.querySelectorAll('.codicon-robot')).toHaveLength(0)
    expect(container.querySelectorAll('.codicon-loading.codicon-modifier-spin')).toHaveLength(1)
  })
})
