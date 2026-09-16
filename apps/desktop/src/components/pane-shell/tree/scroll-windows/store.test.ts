import { beforeEach, describe, expect, it, vi } from 'vitest'

const key = 'hermes.desktop.scrollWindows.workspaces.v1'
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('scroll workspace persistence', () => {
  it('moves from the actual owning desktop, preserves stacks, and restores ownership after reload', async () => {
    const store = await import('./store')
    store.setLayoutSurfaceMode('scroll-windows')
    store.syncScrollWindowWindows(['a', 'b', 'c'])
    store.reorderScrollWindowWindow('b', 'a', 'bottom')
    store.setScrollWorkspaceScroll('1', 40, 0)
    store.setActiveScrollWorkspace('2')
    store.syncScrollWindowWindows(['a', 'b', 'c', 'd'])
    store.moveScrollWindowToWorkspace('b', '2')
    expect(store.$scrollWindowWorkspaces.get()[0]).toMatchObject({ columns: [['a'], ['c']], scrollLeft: 40, focusedWindowId: 'a' })
    expect(store.$scrollWindowWorkspaces.get()[1]).toMatchObject({ columns: [['d'], ['b']], focusedWindowId: 'b' })
    const snapshot = store.$scrollWindowWorkspaces.get()
    store.moveScrollWindowToWorkspace('b', '2')
    store.moveScrollWindowToWorkspace('missing', '1')
    store.moveScrollWindowToWorkspace('b', '99')
    expect(store.$scrollWindowWorkspaces.get()).toBe(snapshot)
    store.moveScrollWindowToWorkspace('b', '1')
    expect(store.$activeScrollWorkspaceId.get()).toBe('1')
    store.syncScrollWindowWindows(['a', 'b', 'c', 'd'])
    const expected = store.$scrollWindowWorkspaces.get().map(workspace => workspace.columns)
    vi.resetModules()
    const restored = await import('./store')
    expect(restored.$scrollWindowWorkspaces.get().map(workspace => workspace.columns)).toEqual(expected)
    expect(restored.$activeScrollWorkspaceId.get()).toBe('1')
  })

  it('retains a reveal requested before a terminal card mounts, only in scroll mode', async () => {
    const store = await import('./store')
    store.requestScrollWindowIntoView('terminal-instance:one')
    expect(store.$scrollWindowRevealRequest.get()).toBeNull()
    store.$layoutSurfaceMode.set('scroll-windows')
    store.requestScrollWindowIntoView('terminal-instance:one')
    store.syncScrollWindowWindows(['workspace', 'terminal-instance:one'])
    expect(store.$scrollWindowRevealRequest.get()).toBe('terminal-instance:one')
    expect(store.$scrollWindowWorkspaces.get()[0].windowIds).toContain('terminal-instance:one')
  })
  it('migrates a legacy grid, persists independent stacks and restores them unchanged', async () => {
    localStorage.setItem(key, JSON.stringify([{ id: '1', windowIds: ['a', 'b', 'c', 'd'], rowCount: 2 }]))
    const store = await import('./store')
    expect(store.$scrollWindowWorkspaces.get()[0].columns).toEqual([
      ['a', 'c'],
      ['b', 'd']
    ])
    store.reorderScrollWindowWindow('c', 'd', 'right')
    expect(store.$scrollWindowWorkspaces.get()[0].columns).toEqual([['a'], ['b', 'd'], ['c']])
    store.syncScrollWindowWindows(['a', 'b', 'c', 'd', 'new'])
    const expected = [['a'], ['b', 'd'], ['c'], ['new']]
    expect(store.$scrollWindowWorkspaces.get()[0].columns).toEqual(expected)
    vi.resetModules()
    const reloaded = await import('./store')
    expect(reloaded.$scrollWindowWorkspaces.get()[0].columns).toEqual(expected)
    reloaded.syncScrollWindowWindows(['a', 'c', 'd', 'new'])
    expect(reloaded.$scrollWindowWorkspaces.get()[0].columns).toEqual([['a'], ['d'], ['c'], ['new']])
  })
  it('does not mutate another workspace during split and ignores invalid drops', async () => {
    const store = await import('./store')
    store.syncScrollWindowWindows(['a', 'b'])
    store.setActiveScrollWorkspace('2')
    store.syncScrollWindowWindows(['a', 'b', 'c', 'd'])
    store.reorderScrollWindowWindow('d', 'c', 'bottom')
    store.reorderScrollWindowWindow('a', 'c', 'left')
    const [first, second] = store.$scrollWindowWorkspaces.get()
    expect(first.columns).toEqual([['a'], ['b']])
    expect(second.columns).toEqual([['c', 'd']])
    expect(second.windowIds).toEqual(second.columns.flat())
  })
  it('does not publish tiny scroll-position jitter', async () => {
    const store = await import('./store')
    const listener = vi.fn()
    const unlisten = store.$scrollWindowWorkspaces.listen(listener)

    store.setScrollWorkspaceScroll('1', 20, 0)
    store.setScrollWorkspaceScroll('1', 20.4, 0.2)
    store.setScrollWorkspaceScroll('1', 22, 0)
    unlisten()

    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.$scrollWindowWorkspaces.get()[0]).toMatchObject({ scrollLeft: 22, scrollTop: 0 })
  })
})
