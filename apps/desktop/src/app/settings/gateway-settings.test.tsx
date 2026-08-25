import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProfileInfo } from '@/types/hermes'

const getConnectionConfig = vi.fn()
const saveConnectionConfig = vi.fn()
const localServicesStatus = vi.fn()
const installBackend = vi.fn()
const restartBackend = vi.fn()
const restartGateway = vi.fn()
const profiles = atom<ProfileInfo[]>([])

vi.mock('@/store/profile', () => ({
  $profiles: profiles,
  refreshActiveProfile: vi.fn()
}))

const localConnection = {
  cloudOrg: '',
  envOverride: false,
  mode: 'local',
  remoteAuthMode: 'token',
  remoteOauthConnected: false,
  remoteTokenPreview: null,
  remoteTokenSet: false,
  remoteUrl: ''
}

beforeEach(() => {
  profiles.set([
    {
      has_env: false,
      is_default: true,
      model: null,
      name: 'default',
      path: '/tmp/hermes',
      provider: null,
      skill_count: 0
    },
    {
      has_env: false,
      is_default: false,
      model: null,
      name: 'work',
      path: '/tmp/hermes/profiles/work',
      provider: null,
      skill_count: 0
    }
  ])
  getConnectionConfig.mockResolvedValue(localConnection)
  saveConnectionConfig.mockResolvedValue(localConnection)
  localServicesStatus.mockResolvedValue({
    descriptor: {
      installLabel: 'Install always-on local backend',
      manager: 'launchd',
      restartLabel: 'Restart local backend',
      serviceName: 'ai.hermes.serve',
      supported: true
    },
    service: { action: 'status-local-backend', manager: 'launchd', message: 'running', ok: true, serviceName: 'ai.hermes.serve' }
  })
  installBackend.mockResolvedValue({ action: 'install-local-backend', message: 'installed', ok: true })
  restartBackend.mockResolvedValue({ action: 'restart-local-backend', message: 'restarted backend', ok: true })
  restartGateway.mockResolvedValue({ action: 'restart-gateway', message: 'restarted gateway', ok: true })
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      getConnectionConfig,
      localServices: {
        installBackend,
        restartBackend,
        restartGateway,
        status: localServicesStatus
      },
      saveConnectionConfig
    }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GatewaySettings', () => {
  it('labels local mode as default inheritance for a named profile', async () => {
    const { GatewaySettings } = await import('./gateway-settings')

    render(<GatewaySettings />)
    expect(await screen.findByText('Local gateway')).toBeTruthy()
    expect(
      screen.getByText('Start a private Hermes backend on localhost. This is the default and works offline.')
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'work' }))

    await waitFor(() => expect(getConnectionConfig).toHaveBeenLastCalledWith('work'))
    expect(await screen.findByText('Use default gateway')).toBeTruthy()
    expect(screen.getByText("Remove this profile's override and use the default connection.")).toBeTruthy()
    expect(
      screen.queryByText('Start a private Hermes backend on localhost. This is the default and works offline.')
    ).toBeNull()
  })

  it('shows and wires local always-on service controls in local mode', async () => {
    const { GatewaySettings } = await import('./gateway-settings')

    render(<GatewaySettings />)

    expect(await screen.findByRole('button', { name: 'Restart backend' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restart WhatsApp gateway' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Install always-on backend' })).toBeTruthy()
    expect(screen.getByText('Always-on local services')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restart backend' }))
    await waitFor(() => expect(restartBackend).toHaveBeenCalled())
  })

  it('shows and clears an SSH remote-profile mapping for a named Desktop profile', async () => {
    getConnectionConfig.mockImplementation(async profile =>
      profile === 'work'
        ? {
            ...localConnection,
            mode: 'ssh',
            profile: 'work',
            sshHost: 'remote-box',
            sshUser: 'alice',
            sshPort: 22,
            sshKeyPath: '',
            sshRemoteHermesPath: '/opt/hermes/bin/hermes',
            sshRemoteProfile: 'default'
          }
        : localConnection
    )
    saveConnectionConfig.mockReturnValue(new Promise(() => {}))
    const { GatewaySettings } = await import('./gateway-settings')

    render(<GatewaySettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'work' }))

    await waitFor(() => expect(getConnectionConfig).toHaveBeenLastCalledWith('work'))
    expect(await screen.findByText('Remote profile (optional)')).toBeTruthy()

    const input = screen.getByPlaceholderText('work')

    expect((input as HTMLInputElement).value).toBe('default')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save for next restart' }))

    await waitFor(() =>
      expect(saveConnectionConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: 'work',
          sshRemoteProfile: ''
        })
      )
    )
  })
})
