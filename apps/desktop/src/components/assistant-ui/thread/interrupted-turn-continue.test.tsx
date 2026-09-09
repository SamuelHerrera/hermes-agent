import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { InterruptedTurnContinue } from './interrupted-turn-continue'

const { state } = vi.hoisted(() => ({ state: { thread: { isRunning: false } } }))
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (value: typeof state) => unknown) => select(state)
}))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: { common: { continue: 'Continue' } } }) }))

describe('interrupted turn Continue', () => {
  it('submits an explicit inspect-before-retry continuation through the real submit path', () => {
    const onContinue = vi.fn()
    render(<InterruptedTurnContinue onContinue={onContinue} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onContinue).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN'))
  })
  it('cannot continue while a turn is running', () => {
    state.thread.isRunning = true
    render(<InterruptedTurnContinue onContinue={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    state.thread.isRunning = false
  })
})
