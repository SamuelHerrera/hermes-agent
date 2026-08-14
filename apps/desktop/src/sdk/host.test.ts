import { describe, expect, it, vi } from 'vitest'

import { openRouteTile } from '@/store/route-tiles'
import { host } from '@hermes/plugin-sdk'

vi.mock('@/store/route-tiles', () => ({
  openRouteTile: vi.fn()
}))

describe('plugin host route tile navigation', () => {
  it('lets plugin entry points open a route as a center tab', () => {
    host.openRouteTile('/kanban')

    expect(openRouteTile).toHaveBeenCalledWith('/kanban', 'center')
  })

  it('passes through an explicit tile dock', () => {
    host.openRouteTile('/kanban', 'right')

    expect(openRouteTile).toHaveBeenCalledWith('/kanban', 'right')
  })
})
