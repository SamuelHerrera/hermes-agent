import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'

import { SessionStatusDot } from './session-status-dot'

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
})

describe('SessionStatusDot running icon', () => {
  const spinner = (container: HTMLElement) => container.querySelector('.codicon-loading.codicon-modifier-spin')
  const normalDot = (container: HTMLElement) => container.querySelector('span[aria-hidden="true"].rounded-full')

  it('shows a rotating loading icon while a session is running', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })

    const { container } = render(<SessionStatusDot storedSessionId="s1" />)

    expect(spinner(container)).toBeTruthy()
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
