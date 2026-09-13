import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { clearClarifyRequest, setClarifyRequest } from '@/store/clarify'

import { PendingClarifyBanner } from './pending-clarify-banner'

function renderBanner(gateway = { request: vi.fn(async () => ({ ok: true })) }) {
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PendingClarifyBanner gateway={gateway as never} sessionId="runtime-1" />
    </I18nProvider>
  )

  return gateway.request
}

afterEach(() => {
  cleanup()
  clearClarifyRequest()
  vi.clearAllMocks()
})

describe('PendingClarifyBanner', () => {
  it('keeps the blocking clarify question visible by the composer', () => {
    setClarifyRequest({
      choices: ['staging', 'production'],
      question: 'Which deployment target?',
      requestId: 'clarify-1',
      sessionId: 'runtime-1'
    })

    renderBanner()

    expect(screen.getByText('Which deployment target?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'staging' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'production' })).toBeTruthy()
    expect(document.querySelector('[data-slot="pending-clarify-banner"]')).toBeTruthy()
  })

  it('answers a choice and clears the parked request', async () => {
    setClarifyRequest({
      choices: ['staging', 'production'],
      question: 'Which deployment target?',
      requestId: 'clarify-1',
      sessionId: 'runtime-1'
    })
    const request = renderBanner()

    fireEvent.click(screen.getByRole('button', { name: 'production' }))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('clarify.respond', { answer: 'production', request_id: 'clarify-1' })
    )
    await waitFor(() => expect(document.querySelector('[data-slot="pending-clarify-banner"]')).toBeNull())
  })

  it('renders a free-text answer path when there are no choices', async () => {
    setClarifyRequest({
      choices: null,
      question: 'What should I call this?',
      requestId: 'clarify-free',
      sessionId: 'runtime-1'
    })
    const request = renderBanner()

    fireEvent.change(screen.getByPlaceholderText('Type your answer…'), { target: { value: 'Launch plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('clarify.respond', { answer: 'Launch plan', request_id: 'clarify-free' })
    )
  })

  it('ignores clarify prompts from other sessions', () => {
    setClarifyRequest({
      choices: ['staging'],
      question: 'Which target?',
      requestId: 'clarify-other',
      sessionId: 'runtime-2'
    })

    renderBanner()

    expect(document.querySelector('[data-slot="pending-clarify-banner"]')).toBeNull()
  })
})
