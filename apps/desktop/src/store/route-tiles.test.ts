import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/pane-shell/tree/store', () => ({
  revealTreePane: vi.fn()
}))

describe('route tiles', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('can open a route as a center-docked tab and immediately front it', async () => {
    const { revealTreePane } = await import('@/components/pane-shell/tree/store')
    const { $routeTiles, openRouteTile } = await import('./route-tiles')

    openRouteTile('/kanban', 'center')

    expect($routeTiles.get()).toEqual([{ dir: 'center', path: '/kanban' }])
    expect(revealTreePane).toHaveBeenCalledWith('route-tile:/kanban')
  })

  it('fronts an already-open route tile without duplicating it', async () => {
    const { revealTreePane } = await import('@/components/pane-shell/tree/store')
    const { $routeTiles, openRouteTile } = await import('./route-tiles')

    openRouteTile('/kanban', 'center')
    openRouteTile('/kanban', 'right')

    expect($routeTiles.get()).toEqual([{ dir: 'center', path: '/kanban' }])
    expect(revealTreePane).toHaveBeenCalledTimes(2)
    expect(revealTreePane).toHaveBeenLastCalledWith('route-tile:/kanban')
  })
})