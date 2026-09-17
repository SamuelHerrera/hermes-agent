import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { QuestionRow } from './question-row'

const copy = {
  resume: 'Continue with saved answer',
  answer: 'Answer and continue',
  other: 'Other answer',
  hard: 'User required',
  soft: 'Soft question',
  session: 'Open session',
  automatic: 'Automatic answer',
  user: 'Your answer'
}

const row = {
  id: 'q1',
  session_id: 's1',
  question: 'Output format?',
  choices: ['CSV', 'JSON'],
  multi_select: false,
  requires_user: false,
  status: 'open',
  answer: null,
  answered_by: null,
  review: null
}

describe('QuestionRow', () => {
  afterEach(() => vi.restoreAllMocks())
  it('can retry delivery of an immutable saved answer after restart', async () => {
    const answer = vi.fn().mockResolvedValue(undefined)
    render(
      <QuestionRow
        copy={copy}
        onAnswer={answer}
        onOpen={vi.fn()}
        row={{ ...row, status: 'answered', answer: 'CSV', answered_by: 'user', delivery_pending: true }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: copy.resume }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith('CSV'))
    expect(screen.queryByRole('radio')).toBeNull()
  })
  it('renders every option and submits only the chosen answer', async () => {
    const answer = vi.fn().mockResolvedValue(undefined)
    render(<QuestionRow copy={copy} onAnswer={answer} onOpen={vi.fn()} row={row} />)
    fireEvent.click(screen.getByLabelText('JSON'))
    fireEvent.click(screen.getByRole('button', { name: copy.answer }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith('JSON'))
  })
  it('supports multiple choices without flattening them into prose', async () => {
    const answer = vi.fn().mockResolvedValue(undefined)
    render(<QuestionRow copy={copy} onAnswer={answer} onOpen={vi.fn()} row={{ ...row, multi_select: true }} />)
    fireEvent.click(screen.getByLabelText('CSV'))
    fireEvent.click(screen.getByLabelText('JSON'))
    fireEvent.click(screen.getByRole('button', { name: copy.answer }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith(['CSV', 'JSON']))
  })
  it('leaves the options available after a failed answer', async () => {
    render(
      <QuestionRow copy={copy} onAnswer={vi.fn().mockRejectedValue(new Error('Offline'))} onOpen={vi.fn()} row={row} />
    )
    fireEvent.click(screen.getByLabelText('CSV'))
    fireEvent.click(screen.getByRole('button', { name: copy.answer }))
    expect((await screen.findByRole('alert')).textContent).toContain('Offline')
    expect((screen.getByRole('button', { name: copy.answer }) as HTMLButtonElement).disabled).toBe(false)
  })
})
