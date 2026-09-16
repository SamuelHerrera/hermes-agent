import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { setApiRequestProfile } from '@/hermes'
import { $activeProfile } from '@/store/profile'

import { SudoSettings } from './sudo-settings'

const api = vi.fn()
let state: Record<string, unknown>
beforeEach(() => {
  state = {
    owner: { host: 'remote-hp', home: '/profiles/work' },
    password_set: true,
    file: '',
    files: { hp: '/secrets/hp' },
    file_availability: 'unset',
    availability: { hp: 'available' }
  }
  api.mockImplementation(async req => {
    if (req.path.endsWith('/password')) {
      state.password_set = req.method !== 'DELETE'
    }

    if (req.path.endsWith('/files')) {
      Object.assign(state, req.body)
    }

    if (req.path.endsWith('/file-password')) {
      state.files = {
        ...(state.files as object),
        [req.body.host]: `/profiles/work/sudo-passwords/${req.body.host}.password`
      }
      state.availability = { ...(state.availability as object), [req.body.host]: 'available' }
    }

    if (req.path.startsWith('/api/fs/list?')) {
      return { entries: [{ name: 'host-password', path: '/backend/secrets/host-password', isDirectory: false }] }
    }

    return structuredClone(state)
  })
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }
  setApiRequestProfile('work')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  setApiRequestProfile(null)
  $activeProfile.set('default')
})

it('saves a masked local file on the owning profile without revealing the old secret', async () => {
  render(<SudoSettings />)
  expect(await screen.findByText('remote-hp')).toBeTruthy()
  const password = screen.getByLabelText('New sudo password') as HTMLInputElement
  expect(password.type).toBe('password')
  expect(password.value).toBe('')
  fireEvent.change(password, { target: { value: ' synthetic-new ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/settings/sudo/file-password',
      profile: 'work',
      method: 'PUT',
      body: { host: 'local', password: ' synthetic-new ', overwrite: true }
    })
  )
  expect(password.value).toBe('')
  expect(api.mock.calls.every(([r]) => !r.path.includes('reveal'))).toBe(true)
  expect(screen.getByTitle('/profiles/work/sudo-passwords/local.password').textContent).toBe(
    '$HERMES_HOME/sudo-passwords/local.password'
  )
})

it('edits host references and reopens from server truth', async () => {
  const view = render(<SudoSettings />)
  fireEvent.click(await screen.findByRole('button', { name: 'hp' }))
  fireEvent.change(screen.getByLabelText('Password file'), { target: { value: '/secrets/replaced' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save reference' })))
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      profile: 'work',
      path: '/api/settings/sudo/files',
      body: { file: '', files: { hp: '/secrets/replaced' } }
    })
  )
  view.unmount()
  render(<SudoSettings />)
  fireEvent.click(await screen.findByRole('button', { name: 'hp' }))
  expect((screen.getByLabelText('Password file') as HTMLInputElement).value).toBe('/secrets/replaced')
})

it('confirms .env removal and dedicated file replacement in app dialogs', async () => {
  render(<SudoSettings />)
  await screen.findByText('remote-hp')
  fireEvent.click(screen.getByText('Existing fallback sources'))
  fireEvent.click(screen.getByRole('button', { name: 'Remove password' }))
  expect(api.mock.calls.some(([r]) => r.method === 'DELETE')).toBe(false)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({ path: '/api/settings/sudo/password', method: 'DELETE', profile: 'work' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add host' }))
  fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'higole' } })
  fireEvent.change(screen.getByLabelText('New sudo password'), { target: { value: 'synthetic-file' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  expect(api.mock.calls.some(([r]) => r.path.endsWith('/file-password'))).toBe(false)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/settings/sudo/file-password',
      profile: 'work',
      body: { host: 'higole', password: 'synthetic-file', overwrite: true }
    })
  )
  expect(screen.queryByDisplayValue('synthetic-file')).toBeNull()
  expect(screen.getByRole('button', { name: 'higole' })).toBeTruthy()
})

it('drops old-owner responses and clears password drafts when switching profiles', async () => {
  let finish: (value: unknown) => void = () => undefined
  render(<SudoSettings />)
  await screen.findByText('remote-hp')
  fireEvent.change(screen.getByLabelText('New sudo password'), { target: { value: 'never-carry-over' } })
  api.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  state = {
    ...state,
    password_set: false,
    owner: { host: 'backend-b', home: '/profiles/b' },
    files: {},
    availability: {}
  }
  await act(async () => {
    setApiRequestProfile('b')
    $activeProfile.set('b')
  })
  await screen.findByText('backend-b')
  await act(async () => finish({ ...state, owner: { host: 'stale-host', home: '/old' }, password_set: true }))
  expect(screen.queryByText('stale-host')).toBeNull()
  expect((screen.getByLabelText('New sudo password') as HTMLInputElement).value).toBe('')
  expect(api.mock.calls.find(([r]) => r.method === 'PUT')?.[0].profile).toBe('work')
})

it('offers recovery for an older backend without showing a configured state', async () => {
  api.mockResolvedValue('<html>old-backend</html>')
  render(<SudoSettings />)
  expect(await screen.findByText('Sudo settings unavailable')).toBeTruthy()
  expect(screen.queryByLabelText('New sudo password')).toBeNull()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
})

it('selects a host and saves a direct value as a private, runtime-referenced file', async () => {
  render(<SudoSettings />)
  fireEvent.click(await screen.findByRole('button', { name: 'hp' }))
  fireEvent.click(screen.getByRole('button', { name: 'Enter password' }))
  const password = screen.getByLabelText('New sudo password') as HTMLInputElement
  expect(password.type).toBe('password')
  fireEvent.change(password, { target: { value: 'synthetic-host-value' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/settings/sudo/file-password',
      profile: 'work',
      body: { host: 'hp', password: 'synthetic-host-value', overwrite: true }
    })
  )
  expect(password.value).toBe('')
})

it('browses only backend metadata and persists the chosen path without reading a file', async () => {
  render(<SudoSettings />)
  fireEvent.click(await screen.findByRole('button', { name: 'hp' }))
  fireEvent.click(screen.getByRole('button', { name: 'Browse files' }))
  fireEvent.click(await screen.findByRole('button', { name: 'host-password' }))
  expect((screen.getByLabelText('Password file') as HTMLInputElement).value).toBe('/backend/secrets/host-password')
  expect(api).toHaveBeenCalledWith({ path: '/api/fs/list?path=%2Fprofiles%2Fwork', profile: 'work' })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save reference' })))
  expect(state.files).toEqual({ hp: '/backend/secrets/host-password' })
  expect(api.mock.calls.some(([request]) => /read-text|read-data|reveal/.test(request.path))).toBe(false)
})

it('clears a password when switching hosts or methods', async () => {
  render(<SudoSettings />)
  const password = await screen.findByLabelText('New sudo password')
  fireEvent.change(password, { target: { value: 'discard-on-switch' } })
  fireEvent.click(screen.getByRole('button', { name: 'hp' }))
  fireEvent.click(screen.getByRole('button', { name: 'Enter password' }))
  expect((screen.getByLabelText('New sudo password') as HTMLInputElement).value).toBe('')
  fireEvent.change(screen.getByLabelText('New sudo password'), { target: { value: 'discard-on-method' } })
  fireEvent.click(screen.getByRole('button', { name: 'Select file' }))
  fireEvent.click(screen.getByRole('button', { name: 'Enter password' }))
  expect((screen.getByLabelText('New sudo password') as HTMLInputElement).value).toBe('')
})

it('shows a failed save without retaining the secret or claiming success', async () => {
  const { container } = render(<SudoSettings />)
  const password = await screen.findByLabelText('New sudo password')
  fireEvent.change(password, { target: { value: 'never-echo-error' } })
  api.mockRejectedValueOnce(new Error('never-echo-error'))
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
  expect(screen.queryByText('Saved')).toBeNull()
  expect((password as HTMLInputElement).value).toBe('')
  expect(container.textContent).not.toContain('never-echo-error')
})

it('removes only the selected reference and keeps other hosts and the fallback', async () => {
  state.file = '/fallback'
  state.files = { hp: '/secrets/hp', higole: '/secrets/higole' }
  render(<SudoSettings />)
  fireEvent.click(await screen.findByRole('button', { name: 'hp' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove reference' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
  expect(state.files).toEqual({ higole: '/secrets/higole' })
  expect(state.file).toBe('/fallback')
})

it('does not label a missing legacy file as a configured password', async () => {
  state.password_set = false
  state.file = '/missing-fallback'
  state.file_availability = 'missing'
  render(<SudoSettings />)
  expect(await screen.findByText('Missing')).toBeTruthy()
  expect(screen.queryByText('Password configured')).toBeNull()
})
