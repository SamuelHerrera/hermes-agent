import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

it('saves a masked replacement on the owning profile without revealing the old secret', async () => {
  render(<SudoSettings />)
  expect(await screen.findByText('remote-hp')).toBeTruthy()
  const password = screen.getByLabelText('New sudo password') as HTMLInputElement
  expect(password.type).toBe('password')
  expect(password.value).toBe('')
  fireEvent.change(password, { target: { value: ' synthetic-new ' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save password' })))
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/settings/sudo/password',
      profile: 'work',
      method: 'PUT',
      body: { password: ' synthetic-new ' }
    })
  )
  expect(password.value).toBe('')
  expect(api.mock.calls.every(([r]) => !r.path.includes('reveal'))).toBe(true)
})

it('edits host references and reopens from server truth', async () => {
  const view = render(<SudoSettings />)
  const host = await screen.findByLabelText('Host 1')
  fireEvent.change(host, { target: { value: '192.168.68.57' } })
  fireEvent.change(screen.getByLabelText('Password file 1'), { target: { value: '/secrets/replaced' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save file references' })))
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      profile: 'work',
      path: '/api/settings/sudo/files',
      body: { file: '', files: { '192.168.68.57': '/secrets/replaced' } }
    })
  )
  view.unmount()
  render(<SudoSettings />)
  await waitFor(() => expect((screen.getByLabelText('Host 1') as HTMLInputElement).value).toBe('192.168.68.57'))
})

it('confirms .env removal and dedicated file replacement in app dialogs', async () => {
  render(<SudoSettings />)
  await screen.findByText('remote-hp')
  fireEvent.click(screen.getByRole('button', { name: 'Remove password' }))
  expect(api.mock.calls.some(([r]) => r.method === 'DELETE')).toBe(false)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({ path: '/api/settings/sudo/password', method: 'DELETE', profile: 'work' })
  )
  fireEvent.change(screen.getByLabelText('File host'), { target: { value: 'higole' } })
  fireEvent.change(screen.getByLabelText('New file password'), { target: { value: 'synthetic-file' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create / replace host password file' }))
  expect(api.mock.calls.some(([r]) => r.path.endsWith('/file-password'))).toBe(false)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/settings/sudo/file-password',
      profile: 'work',
      body: { host: 'higole', password: 'synthetic-file', overwrite: true }
    })
  )
  expect((screen.getByLabelText('New file password') as HTMLInputElement).value).toBe('')
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
