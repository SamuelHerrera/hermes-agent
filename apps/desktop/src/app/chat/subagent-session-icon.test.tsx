import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'
import type { SessionInfo } from '@/types/hermes'

import { SessionTabLead } from './subagent-session-icon'

afterEach(() => {
  clearAllSessionStates()
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
})
