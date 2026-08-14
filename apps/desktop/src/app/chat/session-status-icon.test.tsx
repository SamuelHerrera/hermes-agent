import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { $backgroundStatusBySession } from '@/store/composer-status'
import { $unreadFinishedSessionIds } from '@/store/session'
import { clearAllSessionStates, publishSessionState, setSessionStalled } from '@/store/session-states'

import { SessionStatusIcon } from './session-status-dot'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        row: {
          backgroundRunning: 'Background task running',
          draftSession: 'Draft — nothing sent yet',
          finishedUnread: 'Finished — unread',
          needsInput: 'Needs your input',
          sessionRunning: 'Session running',
          waitingForAnswer: 'Waiting for your answer'
        }
      }
    }
  })
}))

const tipTrigger = (el: HTMLElement) => el.closest('[data-slot="tooltip-trigger"]')

const renderStatus = (storedSessionId: null | string = 's1') => render(<SessionStatusIcon storedSessionId={storedSessionId} />)

afterEach(() => {
  cleanup()
  clearAllSessionStates()
  $backgroundStatusBySession.set({})
  $unreadFinishedSessionIds.set([])
})

describe('SessionStatusIcon', () => {
  it('renders nothing for an idle session', () => {
    const { container } = renderStatus()

    expect(container.querySelector('[data-session-status]')).toBeNull()
  })

  it('shows a tooltip-backed terminal icon for a running background task', () => {
    publishSessionState('rt1', createClientSessionState('s1'))
    $backgroundStatusBySession.set({
      rt1: [
        {
          id: 'proc-1',
          state: 'running',
          title: 'watch uploader',
          type: 'background'
        }
      ]
    })

    const { container } = renderStatus()
    const status = container.querySelector<HTMLElement>('[data-session-status="background"]')

    expect(status?.querySelector('.codicon-terminal')).toBeTruthy()
    expect(status?.getAttribute('aria-label')).toBe('Background task running')
    expect(status?.tabIndex).toBe(0)
    expect(tipTrigger(status as HTMLElement)).toBeTruthy()
  })

  it('shows a spinner while the session turn is working', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })

    const { container } = renderStatus()

    expect(container.querySelector('[data-session-status="working"] .codicon-loading.codicon-modifier-spin')).toBeTruthy()
  })

  it('shows a muted spinner when a working session has stalled', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })
    setSessionStalled('s1', true)

    const { container } = renderStatus()
    const status = container.querySelector<HTMLElement>('[data-session-status="stalled"]')

    expect(status?.querySelector('.codicon-loading.codicon-modifier-spin')).toBeTruthy()
    expect(status?.classList.contains('opacity-70')).toBe(true)
  })

  it('shows an amber question icon when the session needs input', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), needsInput: true })

    const { container } = renderStatus()
    const status = container.querySelector<HTMLElement>('[data-session-status="needs-input"]')

    expect(status?.querySelector('.codicon-question')).toBeTruthy()
    expect(status?.getAttribute('aria-label')).toBe('Waiting for your answer')
  })

  it('shows a green check when a finished session is unread', () => {
    $unreadFinishedSessionIds.set(['s1'])

    const { container } = renderStatus()

    expect(container.querySelector('[data-session-status="unread"] .codicon-check')).toBeTruthy()
  })

  it('shows an edit icon for a draft session', () => {
    const { container } = renderStatus(null)

    expect(container.querySelector('[data-session-status="draft"] .codicon-edit')).toBeTruthy()
  })
})
