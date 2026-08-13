import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'

import { SessionTabRunningArc } from './session-status-dot'

afterEach(() => {
  cleanup()
  clearAllSessionStates()
})

describe('SessionTabRunningArc', () => {
  const arc = (container: HTMLElement) => container.querySelector('.arc-tab')

  it('does not mark a settled tab', () => {
    const { container } = render(<SessionTabRunningArc storedSessionId="s1" />)

    expect(arc(container)).toBeNull()
  })

  it('marks a running tab with the shared arc treatment', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })

    const { container } = render(<SessionTabRunningArc storedSessionId="s1" />)

    expect(arc(container)).toBeTruthy()
  })

  it('reacts when the tab starts running after render', () => {
    const { container } = render(<SessionTabRunningArc storedSessionId="s1" />)

    expect(arc(container)).toBeNull()

    act(() => {
      publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })
    })

    expect(arc(container)).toBeTruthy()
  })
})
