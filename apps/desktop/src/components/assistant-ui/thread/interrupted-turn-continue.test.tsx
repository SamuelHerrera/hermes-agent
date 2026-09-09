import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InterruptedTurnContinue } from './interrupted-turn-continue'

const { append, state } = vi.hoisted(() => ({ append: vi.fn(), state: { thread: { isRunning: false } } }))
vi.mock('@assistant-ui/react', () => ({
  useThreadRuntime: () => ({ append }),
  useAuiState: (select: (value: typeof state) => unknown) => select(state)
}))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: { common: { continue: 'Continue' } } }) }))

describe('interrupted turn Continue', () => {
  it('submits an explicit inspect-before-retry continuation through the thread runtime', () => {
    render(<InterruptedTurnContinue />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: expect.stringContaining('UNKNOWN') }]
      })
    )
  })
  it('cannot continue while a turn is running', () => {
    state.thread.isRunning = true
    render(<InterruptedTurnContinue />)
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    state.thread.isRunning = false
  })
})
