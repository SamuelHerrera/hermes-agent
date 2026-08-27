import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { $unreadFinishedSessionIds } from '@/store/session'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'

import { SessionStatusDot } from './session-status-dot'
import { SessionTabAttentionDot, SessionTabLead } from './subagent-session-icon'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        row: {
          backgroundRunning: 'Running in background',
          draftSession: 'Draft session',
          finishedUnread: 'Finished',
          needsInput: 'Needs input',
          sessionRunning: 'Running',
          waitingForAnswer: 'Waiting for answer'
        }
      }
    }
  })
}))

afterEach(() => {
  cleanup()
  clearAllSessionStates()
  $unreadFinishedSessionIds.set([])
})

const spinner = (container: HTMLElement) => container.querySelector('.codicon-loading.codicon-modifier-spin')
const normalDot = (container: HTMLElement) => container.querySelector('span[aria-hidden="true"].rounded-full')

describe('SessionStatusDot running icon', () => {
  it('shows a rotating loading icon while a session is running', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })

    const { container } = render(<SessionStatusDot storedSessionId="s1" />)

    expect(spinner(container)).toBeTruthy()
    expect(normalDot(container)).toBeTruthy()
  })

  it('does not show a rotating loading icon for a settled session', () => {
    const { container } = render(<SessionStatusDot storedSessionId="s1" />)

    expect(spinner(container)).toBeNull()
    expect(normalDot(container)).toBeTruthy()
  })

  it('switches back to the normal idle dot when running clears', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })
    const { container } = render(<SessionStatusDot storedSessionId="s1" />)

    expect(spinner(container)).toBeTruthy()

    act(() => {
      clearAllSessionStates()
    })

    expect(spinner(container)).toBeNull()
    expect(normalDot(container)).toBeTruthy()
  })
})

describe('session tab attention treatment', () => {
  it('wraps the leading project dot with the spinner while a session is running', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })

    const lead = render(<SessionTabLead session={{ id: 's1' } as never} storedSessionId="s1" />)

    expect(lead.container.querySelector('[data-session-project-dot] [data-session-status="working"]')).toBeTruthy()
    expect(lead.container.querySelector('.codicon-loading.codicon-modifier-spin')).toBeTruthy()
    expect(normalDot(lead.container)).toBeTruthy()

    const attention = render(<SessionTabAttentionDot storedSessionId="s1" />)

    expect(attention.container.querySelector('[data-session-attention-dot]')).toBeNull()
  })

  it('keeps the identity dot in the lead slot and renders unread completion as a trailing check icon', () => {
    $unreadFinishedSessionIds.set(['s1'])

    const lead = render(<SessionTabLead session={{ id: 's1' } as never} storedSessionId="s1" />)

    expect(lead.container.querySelector('[data-session-project-dot]')).toBeTruthy()
    expect(lead.container.querySelector('[data-session-status]')).toBeNull()

    const attention = render(<SessionTabAttentionDot storedSessionId="s1" />)

    expect(attention.container.querySelector('[data-session-attention-dot][data-session-status="unread"]')).toBeTruthy()
    expect(attention.container.querySelector('.codicon-check')).toBeTruthy()
  })

  it('renders needs-input attention as a trailing question icon', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true, needsInput: true })

    const attention = render(<SessionTabAttentionDot storedSessionId="s1" />)

    expect(
      attention.container.querySelector('[data-session-attention-dot][data-session-status="needs-input"]')
    ).toBeTruthy()
    expect(attention.container.querySelector('.codicon-question')).toBeTruthy()
  })
})
