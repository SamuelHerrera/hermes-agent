import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $gateway } from '@/store/gateway'
import { $goalsBySession, type SessionGoal } from '@/store/goals'

import { ComposerStatusStack } from './index'

// The stack measures itself into a surface var — jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const SID = 'sess-goal-1'

const goal = (status: SessionGoal['status'], title = 'ship the feature', detail?: string): SessionGoal => ({
  detail,
  status,
  title,
  updatedAt: Date.now()
})

function renderStack(sessionId: null | string = SID, onEditGoal?: (title: string) => void) {
  return render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <ComposerStatusStack onEditGoal={onEditGoal} queue={null} sessionId={sessionId} />
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('ComposerStatusStack goal indicator', () => {
  beforeEach(() => {
    $goalsBySession.set({})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    $goalsBySession.set({})
  })

  it('renders nothing when the session has no goal', () => {
    const view = renderStack()

    expect(view.container.firstChild).toBeNull()
  })

  it('shows an active goal with its title', () => {
    $goalsBySession.set({ [SID]: goal('active') })

    renderStack()

    expect(screen.getByText('Goal active')).toBeTruthy()
    expect(screen.getByText('ship the feature')).toBeTruthy()
  })

  it('labels a paused goal as paused', () => {
    $goalsBySession.set({ [SID]: goal('paused') })

    renderStack()

    expect(screen.getByText('Goal paused')).toBeTruthy()
    expect(screen.getByText('ship the feature')).toBeTruthy()
  })

  it('shows the continuation detail line for an active goal', () => {
    $goalsBySession.set({ [SID]: goal('active', 'ship it', 'Continuing toward goal (3/20)') })

    renderStack()

    expect(screen.getByText('Continuing toward goal (3/20)')).toBeTruthy()
  })

  it('scopes the indicator to the goal-owning session', () => {
    $goalsBySession.set({ 'other-session': goal('active') })

    const view = renderStack()

    expect(view.container.firstChild).toBeNull()
  })

  it('pauses and resumes the goal from its row controls', async () => {
    $goalsBySession.set({ [SID]: goal('active') })

    const request = vi.fn().mockImplementation((_method, params) =>
      Promise.resolve({
        output: params.arg === 'pause' ? '⏸ Goal paused: ship the feature' : '▶ Goal resumed: ship the feature'
      })
    )

    vi.spyOn($gateway, 'get').mockReturnValue({ request } as unknown as ReturnType<typeof $gateway.get>)

    renderStack()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() => expect($goalsBySession.get()[SID]?.status).toBe('paused'))
    expect(request).toHaveBeenCalledWith('command.dispatch', { name: 'goal', arg: 'pause', session_id: SID })

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))

    await waitFor(() => expect($goalsBySession.get()[SID]?.status).toBe('active'))
    expect(request).toHaveBeenCalledWith('command.dispatch', { name: 'goal', arg: 'resume', session_id: SID })
  })

  it('clears the goal from its stop control', async () => {
    $goalsBySession.set({ [SID]: goal('paused') })
    const request = vi.fn().mockResolvedValue({ output: '✓ Goal cleared.' })
    vi.spyOn($gateway, 'get').mockReturnValue({ request } as unknown as ReturnType<typeof $gateway.get>)

    renderStack()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect($goalsBySession.get()[SID]).toBeUndefined())
    expect(request).toHaveBeenCalledWith('command.dispatch', { name: 'goal', arg: 'clear', session_id: SID })
  })

  it('loads the current goal into the composer for editing', () => {
    $goalsBySession.set({ [SID]: goal('paused') })
    const onEditGoal = vi.fn()

    renderStack(SID, onEditGoal)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(onEditGoal).toHaveBeenCalledWith('ship the feature')
  })
})
