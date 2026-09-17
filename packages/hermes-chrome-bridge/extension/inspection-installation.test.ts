import { expect, it, vi } from 'vitest'

import { installContentListener } from './inspection-installation.js'

it('installs once, replaces old versions, and detects invalidated runtime listeners', () => {
  const listeners = new Set<Function>()
  const event = {addListener: vi.fn((fn: Function) => listeners.add(fn)), removeListener: vi.fn((fn: Function) => listeners.delete(fn)), hasListener: (fn: Function) => listeners.has(fn)}
  const scope = {}
  const dispose = vi.fn()
  const factory = vi.fn(() => ({ listener: vi.fn(), dispose }))
  installContentListener(scope, event, 'v1', factory)
  installContentListener(scope, event, 'v1', factory)
  expect(factory).toHaveBeenCalledTimes(1)
  expect(listeners.size).toBe(1)
  installContentListener(scope, event, 'v2', factory)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(listeners.size).toBe(1)
  listeners.clear()
  installContentListener(scope, event, 'v2', factory)
  expect(factory).toHaveBeenCalledTimes(3)
  expect(listeners.size).toBe(1)
})
