// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { WhatsAppManager } from './whatsapp-manager'

const api = vi.fn()

it('edits receipt and group behavior while distinguishing saved from live receipts', async () => {
  Object.assign(window, { hermesDesktop: { api } })
  api.mockResolvedValue({
    settings: {
      enabled: true,
      mode: 'bot',
      dm_policy: 'allowlist',
      allowed_users: 'owner',
      send_read_receipts: false,
      reply_prefix: 'Header',
      group_policy: 'disabled',
      group_allow_from: '',
      require_mention: false,
      free_response_chats: ''
    },
    paired: true,
    bridge: { state: 'connected', send_read_receipts: false }
  })
  await act(async () => {
    render(<WhatsAppManager />)
  })
  fireEvent.click(screen.getByRole('switch', { name: 'Send read receipts' }))
  fireEvent.change(screen.getByLabelText('Reply header'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('Group policy'), { target: { value: 'allowlist' } })
  fireEvent.change(screen.getByLabelText('Allowed groups'), { target: { value: '123@g.us' } })
  fireEvent.click(screen.getByRole('switch', { name: 'Require a mention in groups' }))
  expect(screen.getByText('Read receipts (running)')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        body: {
          send_read_receipts: true,
          reply_prefix: '',
          group_policy: 'allowlist',
          group_allow_from: '123@g.us',
          require_mention: true
        }
      })
    )
  )
})
vi.mock('@/hermes', () => ({ getApiRequestProfile: () => null }))
vi.mock('@/store/system-actions', () => ({ runGatewayRestart: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it('shows typed settings and saves only changed fields without relaxing the allowlist', async () => {
  Object.assign(window, { hermesDesktop: { api } })
  api.mockResolvedValue({
    settings: { enabled: true, mode: 'bot', dm_policy: 'allowlist', allowed_users: '1555,alias@lid' },
    paired: true,
    account_name: 'Test account',
    bridge: { state: 'connected' }
  })
  await act(async () => {
    render(<WhatsAppManager />)
  })
  expect((screen.getByLabelText('Bridge mode') as HTMLSelectElement).value).toBe('bot')
  expect((screen.getByLabelText('WhatsApp DM policy') as HTMLSelectElement).value).toBe('allowlist')
  expect((screen.getByLabelText('Allowed WhatsApp users') as HTMLInputElement).value).toBe('1555,alias@lid')
  expect(screen.queryByRole('button', { name: 'Start QR pairing' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Bridge mode'), { target: { value: 'self-chat' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ method: 'PUT', body: { mode: 'self-chat' } }))
  )
})

it('restores legacy controls only when the management endpoint is missing', async () => {
  Object.assign(window, { hermesDesktop: { api } })
  api.mockRejectedValue(new Error('HTTP 404: Not Found'))
  const fallback = vi.fn()
  await act(async () => {
    render(<WhatsAppManager onUnavailable={fallback} />)
  })
  await waitFor(() => expect(fallback).toHaveBeenLastCalledWith(true))
})
