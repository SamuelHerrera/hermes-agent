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

const continuousSpinner = (container: HTMLElement) => container.querySelector<HTMLElement>('.codicon-modifier-spin')

const normalDot = (container: HTMLElement) => container.querySelector('span[aria-hidden="true"].rounded-full')
const loadingRing = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-session-status="working"]')
const livePulse = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-session-live-pulse]')

describe('SessionStatusDot running icon', () => {
  it('shows a finite live pulse instead of a continuous spinner while a session is running', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })

    const { container } = render(<SessionStatusDot storedSessionId="s1" />)

    const ring = loadingRing(container)

    expect(continuousSpinner(container)).toBeNull()
    expect(livePulse(container)).toBeTruthy()
    expect(livePulse(container)?.querySelector('.codicon-loading')).toBeTruthy()
    expect(ring?.classList.contains('size-3')).toBe(true)
    expect(normalDot(container)).toBeTruthy()
  })

  it('does not show a live pulse for a settled session', () => {
    const { container } = render(<SessionStatusDot storedSessionId="s1" />)

    expect(continuousSpinner(container)).toBeNull()
    expect(livePulse(container)).toBeNull()
    expect(normalDot(container)).toBeTruthy()
  })

  it('switches back to the normal idle dot when running clears', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })
    const { container } = render(<SessionStatusDot storedSessionId="s1" />)

    expect(livePulse(container)).toBeTruthy()

    act(() => {
      clearAllSessionStates()
    })

    expect(livePulse(container)).toBeNull()
    expect(normalDot(container)).toBeTruthy()
  })
})

describe('session tab attention treatment', () => {
  it('wraps the leading project dot with a finite pulse while a session is running', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })

    const lead = render(<SessionTabLead session={{ id: 's1' } as never} storedSessionId="s1" />)

    const tabRing = loadingRing(lead.container)

    expect(lead.container.querySelector('[data-session-project-dot] [data-session-status="working"]')).toBeTruthy()
    expect(continuousSpinner(lead.container)).toBeNull()
    expect(livePulse(lead.container)).toBeTruthy()
    expect(livePulse(lead.container)?.querySelector('.codicon-loading')).toBeTruthy()
    expect(tabRing?.classList.contains('size-3')).toBe(true)
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
