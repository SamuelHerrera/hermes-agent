import { describe, expect, it } from 'vitest'

import {
  LOCAL_BACKEND_URL,
  localBackendServiceCommand,
  localBackendServiceDescriptor,
  resolveEffectiveLocalProfile,
  resolveLocalBackendServiceUrl,
  shouldUsePersistentLocalBackend
} from './desktop-service-control'

describe('localBackendServiceDescriptor', () => {
  it('maps macOS to launchd', () => {
    const descriptor = localBackendServiceDescriptor('darwin')

    expect(descriptor.supported).toBe(true)
    expect(descriptor.serviceName).toBe('ai.hermes.serve')
    expect(descriptor.manager).toBe('launchd')
    expect(descriptor.installLabel).toMatch(/Install always-on local backend/i)
  })

  it('maps Linux to a user systemd service', () => {
    const descriptor = localBackendServiceDescriptor('linux')

    expect(descriptor.supported).toBe(true)
    expect(descriptor.serviceName).toBe('ai.hermes.serve')
    expect(descriptor.manager).toBe('systemd --user')
  })

  it('maps Windows to a scheduled task', () => {
    const descriptor = localBackendServiceDescriptor('win32')

    expect(descriptor.supported).toBe(true)
    expect(descriptor.serviceName).toBe('ai.hermes.serve')
    expect(descriptor.manager).toBe('Scheduled Task')
  })
})

describe('resolveLocalBackendServiceUrl', () => {
  it('accepts only plain HTTP loopback service URLs', () => {
    expect(resolveLocalBackendServiceUrl()).toBe(LOCAL_BACKEND_URL)
    expect(resolveLocalBackendServiceUrl('http://localhost:9120/')).toBe('http://localhost:9120')
    expect(resolveLocalBackendServiceUrl('http://[::1]:9120')).toBe('http://[::1]:9120')
    expect(resolveLocalBackendServiceUrl('https://127.0.0.1:9119')).toBeNull()
    expect(resolveLocalBackendServiceUrl('http://192.168.1.20:9119')).toBeNull()
    expect(resolveLocalBackendServiceUrl('http://127.0.0.1:9119/proxy')).toBeNull()
  })
})

describe('shouldUsePersistentLocalBackend', () => {
  it('uses the single always-on service only for the default profile', () => {
    expect(shouldUsePersistentLocalBackend(null)).toBe(true)
    expect(shouldUsePersistentLocalBackend('default')).toBe(true)
    expect(shouldUsePersistentLocalBackend('work')).toBe(false)
  })
})

describe('localBackendServiceCommand', () => {
  it('pins the persistent service to the default profile', () => {
    expect(localBackendServiceCommand('/tmp/hermes')).toEqual({
      args: ['--profile', 'default', 'serve', '--host', '127.0.0.1', '--port', '9119', '--skip-build'],
      command: '/tmp/hermes'
    })
  })
})

describe('resolveEffectiveLocalProfile', () => {
  it('uses the Desktop choice first, then sticky profile, then default', () => {
    expect(resolveEffectiveLocalProfile('default', 'work')).toBe('default')
    expect(resolveEffectiveLocalProfile(null, 'work')).toBe('work')
    expect(resolveEffectiveLocalProfile(null, null)).toBe('default')
  })
})
