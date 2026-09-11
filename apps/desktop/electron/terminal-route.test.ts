import { describe, expect, it, vi } from 'vitest'

import { resolveTerminalRoute } from './terminal-route'

describe('terminal owner route', () => {
  it('keeps legacy/default local even with another active profile', async () => {
    const resolve = vi.fn(async () => null)
    expect(await resolveTerminalRoute(undefined, resolve, () => null)).toEqual({ kind: 'local', profile: 'default' })
    expect(resolve).toHaveBeenCalledWith('default')
  })

  it.each(['local', 'remote', 'ssh'])('captures owner before an async %s connection completes', async kind => {
    let active = 'A'
    let ready!: (connection: unknown) => void

    const connection = {
      mode: 'remote',
      source: 'profile',
      remoteKind: kind === 'ssh' ? 'ssh' : 'url',
      baseUrl: 'http://A:9119'
    }

    const resolve = vi.fn(
      () =>
        new Promise(resolve => {
          ready = resolve
        })
    )

    const ssh = { host: 'A' }
    const pending = resolveTerminalRoute(active, resolve, scope => (scope === 'A' ? { ssh } : null))
    active = 'B'
    ready(kind === 'local' ? null : connection)
    const route = await pending
    expect(route.profile).toBe('A')
    expect(route.kind).toBe(kind)
    expect(resolve).toHaveBeenCalledWith('A')

    if (route.kind === 'remote') {
      expect(route.connection).toBe(connection)
    }

    if (route.kind === 'ssh') {
      expect(route.target.ssh).toBe(ssh)
    }
  })

  it('fails closed when the SSH owner is unavailable', async () => {
    await expect(
      resolveTerminalRoute(
        'A',
        async () => ({ remoteKind: 'ssh', source: 'profile' }),
        () => null
      )
    ).rejects.toThrow()
  })
})

it.each(['default', 'A'])('uses the explicit SSH scope for %s, never the foreground global scope', async profile => {
  const ssh = { host: profile }
  const getSsh = vi.fn(scope => (scope === profile ? { ssh } : null))
  const route = await resolveTerminalRoute(profile, async () => ({ remoteKind: 'ssh', source: 'profile' }), getSsh)
  expect(route.kind).toBe('ssh')
  expect(getSsh).toHaveBeenCalledWith(profile)
})

it('keeps a global SSH connection on its global scope', async () => {
  const getSsh = vi.fn(() => ({ ssh: { host: 'global-ssh' } }))
  expect((await resolveTerminalRoute('A', async () => ({ remoteKind: 'ssh', source: 'settings' }), getSsh)).kind).toBe(
    'ssh'
  )
  expect(getSsh).toHaveBeenCalledWith('')
})

it('propagates remote connection failure without falling back to local', async () => {
  await expect(
    resolveTerminalRoute(
      'A',
      async () => {
        throw new Error('owner unavailable')
      },
      vi.fn()
    )
  ).rejects.toThrow('owner unavailable')
})
