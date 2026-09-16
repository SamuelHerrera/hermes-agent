import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { EnvVarInfo } from '@/types/hermes'

const api = vi.hoisted(() => ({
  getEnvVars: vi.fn(),
  setEnvVar: vi.fn(),
  deleteEnvVar: vi.fn(),
  revealEnvVar: vi.fn(),
  notifyError: vi.fn()
}))

vi.mock('@/hermes', () => api)
vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: api.notifyError }))

function field(description: string, patch: Partial<EnvVarInfo> = {}): EnvVarInfo {
  return {
    advanced: false,
    category: 'tool',
    description,
    is_password: true,
    is_set: false,
    redacted_value: null,
    tools: [],
    url: null,
    ...patch
  }
}

beforeEach(() => {
  api.getEnvVars.mockResolvedValue({
    FIRECRAWL_API_KEY: field('Firecrawl API key for web search and scraping'),
    FIRECRAWL_API_URL: field('Self-hosted endpoint (optional)', {
      is_password: false,
      is_set: true,
      advanced: true,
      redacted_value: 'http…test'
    }),
    FIRECRAWL_BROWSER_TTL: field('Browser session lifetime', { is_password: false }),
    BROWSERBASE_API_KEY: field('Cloud browser'),
    BROWSERBASE_PROJECT_ID: field('Project ID', { is_password: false }),
    FUTURE_SERVICE_TOKEN: field('Future integration'),
    OPENAI_API_KEY: field('Provider', { category: 'provider' }),
    TELEGRAM_BOT_TOKEN: field('Messaging', { category: 'messaging', channel_managed: true })
  })
  api.setEnvVar.mockResolvedValue({ ok: true })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function mount(route = '/') {
  const { KeysSettings } = await import('./keys-settings')
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <KeysSettings view="tools" />
      </MemoryRouter>
    )
  })
}

it('opens all related fields in one labelled dialog and searches env keys and descriptions', async () => {
  await mount()
  const search = screen.getByRole('textbox', { name: 'Search tools, services or keys…' })
  fireEvent.change(search, { target: { value: 'BROWSERBASE_PROJECT_ID' } })
  expect(screen.queryByRole('button', { name: 'Firecrawl' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Browserbase' }))
  const dialog = screen.getByRole('dialog', { name: 'Browserbase' })
  expect(within(dialog).getByLabelText('BROWSERBASE_API_KEY').getAttribute('type')).toBe('password')
  expect(within(dialog).getByLabelText('BROWSERBASE_PROJECT_ID')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  fireEvent.change(search, { target: { value: 'future integration' } })
  expect(screen.getByRole('button', { name: 'Future Service Token' })).toBeTruthy()
})

it('opens an exact deep-linked field rather than the first credential', async () => {
  await mount('/?key=FIRECRAWL_BROWSER_TTL')
  const dialog = await screen.findByRole('dialog', { name: 'Firecrawl' })
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText('FIRECRAWL_BROWSER_TTL')))
  await waitFor(() =>
    expect(
      document.getElementById('credential-key-FIRECRAWL_BROWSER_TTL')?.classList.contains('setting-field-highlight')
    ).toBe(true)
  )
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Firecrawl' })))
})

it('retains masked drafts on failure and reopening, and does not mark optional fields as ready', async () => {
  api.setEnvVar.mockRejectedValue(new Error('Synthetic save failed'))
  await mount()
  const card = screen.getByRole('button', { name: 'Firecrawl' })
  expect(card.textContent).toContain('Saved fields: 1 / 3')
  expect(card.textContent).not.toMatch(/ready|connected|configured/i)
  fireEvent.click(card)
  const input = screen.getByLabelText('FIRECRAWL_API_KEY')
  fireEvent.change(input, { target: { value: 'synthetic-secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.notifyError).toHaveBeenCalled())
  expect((input as HTMLInputElement).value).toBe('synthetic-secret')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(card)
  expect((screen.getByLabelText('FIRECRAWL_API_KEY') as HTMLInputElement).value).toBe('synthetic-secret')
  expect(screen.getByLabelText('FIRECRAWL_API_KEY').getAttribute('type')).toBe('password')
})

it('reveals only on request, masks on reopen, and saves and removes the exact key', async () => {
  api.revealEnvVar.mockResolvedValue({ value: 'synthetic-revealed' })
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Firecrawl' }))
  const input = screen.getByLabelText('FIRECRAWL_API_KEY')
  fireEvent.change(input, { target: { value: 'synthetic-saved' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.setEnvVar).toHaveBeenCalledWith('FIRECRAWL_API_KEY', 'synthetic-saved'))
  const field = document.getElementById('credential-key-FIRECRAWL_API_KEY')!
  fireEvent.click(await within(field).findByRole('button', { name: 'Reveal value' }))
  expect(await screen.findByText('synthetic-revealed')).toBeTruthy()
  expect(api.revealEnvVar).toHaveBeenCalledWith('FIRECRAWL_API_KEY')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Firecrawl' }))
  expect(screen.queryByText('synthetic-revealed')).toBeNull()
  const reopenedField = document.getElementById('credential-key-FIRECRAWL_API_KEY')!
  fireEvent.focus(within(reopenedField).getByLabelText('FIRECRAWL_API_KEY'))
  fireEvent.click(within(reopenedField).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(api.deleteEnvVar).toHaveBeenCalledWith('FIRECRAWL_API_KEY'))
})

it('groups service fields into one compact card without inline credential editors', async () => {
  await mount()
  expect(screen.getAllByRole('button', { name: /Firecrawl/i })).toHaveLength(1)
  expect(screen.queryByDisplayValue('http…test')).toBeNull()
  expect(screen.queryByText('Openai')).toBeNull()
  expect(screen.queryByText('Telegram Bot')).toBeNull()
})
