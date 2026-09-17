import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as GatewayModule from '@/store/gateway'

const route = vi.hoisted(() => vi.fn())
vi.mock('@/store/gateway', async importOriginal => ({
  ...await importOriginal<typeof GatewayModule>(),
  backgroundGatewayForProfile: route
}))

import { $activeGatewayProfile, $profiles } from '@/store/profile'
import { $currentCwd, $selectedStoredSessionId } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

import { spawnProjectSession } from './session-spawn'

describe('independent project handoff', () => {
  beforeEach(() => {
    route.mockReset()
    $activeGatewayProfile.set('default')
    $selectedStoredSessionId.set('caller')
    $currentCwd.set('/caller')
    $sessionTiles.set([{ storedSessionId: 'existing', runtimeId: 'live-existing' }])
    $profiles.set([])
  })

  it('routes through the chosen backend and leaves the caller untouched', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, status: 'started', session_id: 'new', runtime_session_id: 'live-new', cwd: '/target' })
    route.mockResolvedValue({ gateway: { request }, params: {} })
    const result = await spawnProjectSession({ project: 'Target', prompt: 'only this', open_tab: true }, 'default')
    expect(route).toHaveBeenCalledWith('default')
    expect(request).toHaveBeenCalledWith('session.spawn', expect.objectContaining({ project: 'Target', prompt: 'only this' }))
    expect(result.link).toBe('@session:default/new')
    expect($selectedStoredSessionId.get()).toBe('caller')
    expect($currentCwd.get()).toBe('/caller')
    expect($activeGatewayProfile.get()).toBe('default')
    expect($sessionTiles.get().map(tile => tile.storedSessionId)).toEqual(['existing', 'new'])
  })

  it('rejects unknown profiles without opening a backend', async () => {
    await expect(spawnProjectSession({ project: 'unknown::Target', prompt: 'x' }, 'default')).rejects.toThrow('Unknown Hermes profile')
    expect(route).not.toHaveBeenCalled()
  })

  it('keeps an unqualified shared-primary caller in its backend-derived profile scope', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, status: 'started', session_id: 'work-session' })
    route.mockResolvedValue({ gateway: { request }, params: {} })
    const result = await spawnProjectSession({ project: 'Target', prompt: 'work only' }, 'default', 'work')

    expect(route).toHaveBeenCalledWith('default')
    expect(request).toHaveBeenCalledWith('session.spawn', expect.objectContaining({ project: 'Target', profile: 'work' }))
    expect(result.link).toBe('@session:work/work-session')
    expect($activeGatewayProfile.get()).toBe('default')
  })

  it('uses explicit profile routing, never the active socket or caller model', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, status: 'started', session_id: 'remote', runtime_session_id: 'remote-live' })
    route.mockResolvedValue({ gateway: { request }, params: { profile: 'work' } })
    $profiles.set([{ name: 'work' }] as never)
    const result = await spawnProjectSession({ project: 'work::p_target', prompt: 'x', open_tab: true }, 'default')
    expect(request).toHaveBeenCalledWith('session.spawn', expect.objectContaining({ project: 'p_target', profile: 'work' }))
    expect(result.link).toBe('@session:work/remote')
    expect(result.tab_status).toBe('saved_for_profile')
    expect($sessionTiles.get().map(tile => tile.storedSessionId)).toEqual(['existing'])
    expect($activeGatewayProfile.get()).toBe('default')
  })
})
