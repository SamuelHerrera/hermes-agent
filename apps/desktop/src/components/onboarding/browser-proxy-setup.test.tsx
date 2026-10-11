import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type * as HermesModule from '@/hermes'
import { $desktopOnboarding } from '@/store/onboarding'

import { BrowserProxySetup } from './browser-proxy-setup'

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<typeof HermesModule>()),
  getHermesConfig: api.get,
  saveHermesConfig: api.save
}))

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ desktop: { browser_proxy_setup_complete: false, browser_proxy_port: 9120 } })
  api.save.mockReset().mockResolvedValue({ ok: true, browser_proxy: { running: true } })
  $desktopOnboarding.set({ ...$desktopOnboarding.get(), configured: true, manual: false, firstRunSkipped: false })
})
afterEach(cleanup)

it('asks for the HTTPS origin and saves only proxy settings on the selected profile', async () => {
  render(<BrowserProxySetup enabled profile="coder" />)
  fireEvent.change(await screen.findByLabelText('Separate HTTPS proxy origin'), { target: { value: 'https://browser.example.net/' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and start' }))
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ desktop: {
    browser_proxy_origin: 'https://browser.example.net', browser_proxy_setup_complete: true
  } }, 'coder'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('remembers choosing to configure routing later', async () => {
  render(<BrowserProxySetup enabled profile="default" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up later' }))
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ desktop: { browser_proxy_setup_complete: true } }, 'default'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('rejects insecure origins without saving', async () => {
  render(<BrowserProxySetup enabled profile="default" />)
  fireEvent.change(await screen.findByLabelText('Separate HTTPS proxy origin'), { target: { value: 'http://browser.example.net' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and start' }))
  expect((await screen.findByRole('alert')).textContent).toContain('bare HTTPS origin')
  expect(api.save).not.toHaveBeenCalled()
})

it('shows an actual helper startup failure and allows a retry', async () => {
  api.save.mockResolvedValueOnce({ ok: true, browser_proxy: { running: false, error: 'Listener unavailable' } })
  render(<BrowserProxySetup enabled profile="default" />)
  fireEvent.change(await screen.findByLabelText('Separate HTTPS proxy origin'), { target: { value: 'https://browser.example.net' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and start' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Listener unavailable')
  expect(screen.getByRole('button', { name: 'Save and start' }).hasAttribute('disabled')).toBe(false)
})

it.each([
  {},
  { browser_proxy_setup_complete: true },
  { browser_proxy_setup_complete: false, browser_proxy_origin: 'https://existing.example.net' },
  { browser_proxy_setup_complete: false, browser_access_enabled: false },
])('does not prompt when setup is absent, complete, configured, or disabled: %j', async desktop => {
  api.get.mockResolvedValue({ desktop })
  await act(async () => { render(<BrowserProxySetup enabled profile="default" />) })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.save).not.toHaveBeenCalled()
})

it('waits until provider onboarding is finished', async () => {
  $desktopOnboarding.set({ ...$desktopOnboarding.get(), configured: false })
  await act(async () => { render(<BrowserProxySetup enabled profile="default" />) })
  expect(screen.queryByRole('dialog')).toBeNull()
  act(() => $desktopOnboarding.set({ ...$desktopOnboarding.get(), configured: true }))
  expect(await screen.findByRole('dialog')).not.toBeNull()
})

it('ignores stale config reads after switching backends/profiles', async () => {
  let resolveOld!: (value: unknown) => void
  api.get.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
  const { rerender } = render(<BrowserProxySetup enabled profile="old" />)
  rerender(<BrowserProxySetup enabled profile="new" />)
  await screen.findByRole('dialog')
  await act(async () => resolveOld({ desktop: { browser_proxy_setup_complete: true } }))
  expect(screen.getByRole('dialog')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Set up later' }))
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ desktop: { browser_proxy_setup_complete: true } }, 'new'))
})

it('does not hide a new profile prompt when an older save finishes', async () => {
  let resolveOld!: (value: unknown) => void
  api.save.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
  const { rerender } = render(<BrowserProxySetup enabled profile="old" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up later' }))
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ desktop: { browser_proxy_setup_complete: true } }, 'old'))
  rerender(<BrowserProxySetup enabled profile="new" />)
  await screen.findByRole('dialog')
  await act(async () => resolveOld({ ok: true }))
  expect(screen.getByRole('dialog')).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Set up later' }).hasAttribute('disabled')).toBe(false)
})
