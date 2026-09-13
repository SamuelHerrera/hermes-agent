// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { WhatsAppPairing } from './whatsapp-pairing'
const api = vi.fn()
vi.mock('@/hermes', () => ({ getApiRequestProfile: () => null }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it('starts QR setup only on click and never calls the policy-resetting apply endpoint', async () => {
  Object.assign(window, { hermesDesktop: { api } })
  api.mockResolvedValue({ pairing_id: 'id', status: 'waiting', qr_image: 'data:image/svg+xml;base64,PHN2Zy8+' })
  render(<WhatsAppPairing mode="bot" onPaired={() => {}} />)
  expect(api).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start QR pairing' }))
  })
  expect(screen.getByAltText('WhatsApp pairing QR code')).toBeTruthy()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel QR setup' }))
  })
  await waitFor(() => expect(api).toHaveBeenCalledWith(expect.objectContaining({ method: 'DELETE' })))
  expect(api.mock.calls.some(([r]) => r.path.endsWith('/apply'))).toBe(false)
})
