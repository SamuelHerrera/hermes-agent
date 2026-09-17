import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { questionCopy } from './copy'
import { QuestionNotifications } from './notifications'

const row = {
  id: 'q1',
  session_id: 'chat1',
  question: 'Which format?',
  choices: ['CSV', 'JSON'],
  multi_select: false,
  requires_user: false,
  status: 'open',
  answer: null,
  answered_by: null,
  review: null
}

const gateway = () => ({
  request: vi.fn().mockResolvedValue({ questions: [row], open_count: 1 }),
  onEvent: vi.fn((_listener: (event: { type: string }) => void) => () => {}),
  onState: vi.fn(() => () => {})
})

describe('Question notifications', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  )
  afterEach(() => vi.unstubAllGlobals())
  it('shows an open count on a header button and supports inline replies without opening a chat', async () => {
    const api = gateway()
    const openChat = vi.fn()
    render(
      <QuestionNotifications
        copy={questionCopy.en}
        gateway={api as never}
        onOpenSession={openChat}
        onSettings={vi.fn()}
        profile="default"
      />
    )
    const bell = await screen.findByRole('button', { name: 'Notifications (1)' })
    expect(screen.queryByText('Which format?')).toBeNull()
    fireEvent.click(bell)
    expect(await screen.findByText('Which format?')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect((screen.getByRole('button', { name: 'Answer and continue' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('JSON', { exact: true }))
    api.request.mockResolvedValue({ questions: [], open_count: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Answer and continue' }))
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith('questions.respond', {
        profile: 'default',
        question_id: 'q1',
        answer: 'JSON'
      })
    )
    expect(openChat).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Which format?')).toBeNull())
  })
  it('focuses the associated chat from the question title and closes the popover', async () => {
    const openChat = vi.fn()
    render(
      <QuestionNotifications
        copy={questionCopy.en}
        gateway={gateway() as never}
        onOpenSession={openChat}
        onSettings={vi.fn()}
        profile="default"
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: row.question }))
    expect(openChat).toHaveBeenCalledWith('chat1')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
  it('does not carry old questions or drafts into another profile', async () => {
    const api = gateway()
    const props = { gateway: api as never, copy: questionCopy.en, onOpenSession: vi.fn(), onSettings: vi.fn() }
    const view = render(<QuestionNotifications {...props} profile="first" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Other answer' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private draft' } })
    api.request.mockReturnValue(new Promise(() => {}))
    view.rerender(<QuestionNotifications {...props} profile="second" />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.queryByDisplayValue('Private draft')).toBeNull()
    expect(screen.queryByText(row.question)).toBeNull()
  })
  it('refreshes the closed badge when a question changes', async () => {
    const api = gateway()
    render(
      <QuestionNotifications
        copy={questionCopy.en}
        gateway={api as never}
        onOpenSession={vi.fn()}
        onSettings={vi.fn()}
        profile="default"
      />
    )
    await screen.findByRole('button', { name: 'Notifications (1)' })
    api.request.mockResolvedValue({ questions: [], open_count: 0 })
    await act(async () => api.onEvent.mock.calls[0][0]({ type: 'questions.changed' }))
    await screen.findByRole('button', { name: 'Notifications' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('leaves failed answers open with a retryable error', async () => {
    const api = gateway()
    render(
      <QuestionNotifications
        copy={questionCopy.en}
        gateway={api as never}
        onOpenSession={vi.fn()}
        onSettings={vi.fn()}
        profile="default"
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }))
    fireEvent.click(await screen.findByLabelText('JSON'))
    api.request.mockRejectedValueOnce(new Error('Offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Answer and continue' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Offline')
    expect(screen.getByText(row.question)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Answer and continue' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
