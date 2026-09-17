import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

async function setup() {
  const store = await import('./store')
  const screens = await import('./screens')
  const model = await import('./model')
  const { registry } = await import('@/contrib/registry')

  for (const [id, placement] of [
    ['sessions', 'left'],
    ['workspace', 'main'],
    ['files', 'right']
  ]) {
    registry.register({ id, area: 'panes', data: { placement }, render: () => null })
  }

  const initial = model.split('row', [model.group(['sessions']), model.group(['workspace']), model.group(['files'])])
  store.declareDefaultTree(initial)
  store.watchContributedPanes()

  return { store, screens, model, registry, initial }
}

it('repairs Files beside an empty center when a saved desktop stacked it with Sessions', async () => {
  const { store, screens, model } = await setup()
  screens.$tabbedScreenTrees.set({ ...screens.$tabbedScreenTrees.get(), '5': model.group(['sessions', 'files']) })
  store.setActiveTabbedScreen('5')
  const tree = store.$layoutTree.get()!
  expect(model.findGroupOfPane(tree, 'sessions')!.panes).toEqual(['sessions'])
  expect(model.findGroupOfPane(tree, 'files')!.panes).toEqual(['files'])
  const groups = model.groupLeafIds(tree).map(id => model.findGroup(tree, id)!)
  expect(groups.map(g => g.panes)).toEqual([['sessions'], [], ['files']])
  expect(groups[1].emptyWorkspace).toBe(true)
  expect(screens.ensureTabbedScreenContent(tree)).toBe(tree)
})

it('removes a disposed pane from its inactive desktop without switching focus', async () => {
  const { store, screens, model, registry } = await setup()
  registry.register({ id: 'terminal-instance:gone', area: 'panes', data: { placement: 'main' }, render: () => null })
  store.moveTreePanesToTabbedScreen(['terminal-instance:gone'], '5')
  store.setActiveTabbedScreen('1')
  const active = store.$layoutTree.get()
  store.removeTreePane('terminal-instance:gone')
  expect(screens.$activeTabbedScreen.get()).toBe('1')
  expect(store.$layoutTree.get()).toBe(active)
  expect(model.allPaneIds(screens.$tabbedScreenTrees.get()['5'])).not.toContain('terminal-instance:gone')
  expect(screens.tabbedScreenOwner('terminal-instance:gone')).toBeUndefined()
})

it.each(['tabbed', 'scroll-windows'] as const)(
  'prunes stale mirrored terminals on inactive desktops in %s mode',
  async mode => {
    const { store, screens, model } = await setup()
    const { setLayoutSurfaceMode } = await import('./scroll-windows/store')
    setLayoutSurfaceMode(mode)
    const { atom } = await import('nanostores')
    const { paneMirror } = await import('@/app/chat/pane-mirror')
    screens.$tabbedScreenTrees.set({
      ...screens.$tabbedScreenTrees.get(),
      '5': model.split('row', [model.group(['sessions', 'files']), model.group(['terminal-instance:deleted'])])
    })
    paneMirror<{ id: string }>({
      source: atom([]),
      prefix: 'terminal-instance',
      key: t => t.id,
      minWidth: '1rem',
      title: () => 'Terminal',
      render: () => null,
      close: () => undefined
    })()
    expect(model.allPaneIds(screens.$tabbedScreenTrees.get()['5'])).toEqual(['sessions', 'files'])
    expect(store.treePanesWithPrefix('terminal-instance:')).toEqual([])
  }
)

it.each(['tabbed', 'scroll-windows'] as const)(
  'preserves filtered terminal ownership but removes real deletion in %s mode',
  async mode => {
    const { store, screens, model, registry } = await setup()
    const { $terminals, closeTerminal } = await import('@/app/right-sidebar/terminal/terminals')
    const { watchTerminalPanes } = await import('@/app/right-sidebar/terminal/panes')
    const { $activeGatewayProfile, $showAllProfiles } = await import('@/store/profile')
    const { setLayoutSurfaceMode } = await import('./scroll-windows/store')
    $showAllProfiles.set(true)
    watchTerminalPanes()
    $terminals.set([
      { id: 'profile-a-first', profile: 'a', kind: 'user', title: 'First', auto: false, cwd: '/tmp' },
      { id: 'profile-a-second', profile: 'a', kind: 'user', title: 'Second', auto: false, cwd: '/tmp' }
    ])
    const pane = 'terminal-instance:profile-a-first'
    store.moveTreePanesToTabbedScreen([pane, 'terminal-instance:profile-a-second'], '5')
    store.setActiveTabbedScreen('1')
    setLayoutSurfaceMode(mode)
    const saved = screens.$tabbedScreenTrees.get()['5']
    $activeGatewayProfile.set('b')
    $showAllProfiles.set(false)
    expect(registry.getArea('panes').some(p => p.id === pane)).toBe(false)
    expect($terminals.get()).toHaveLength(2)
    expect(screens.$tabbedScreenTrees.get()['5']).toEqual(saved)
    expect(screens.tabbedScreenOwner(pane)).toBe('5')
    $showAllProfiles.set(true)
    expect(registry.getArea('panes').some(p => p.id === pane)).toBe(true)
    expect(screens.$tabbedScreenTrees.get()['5']).toEqual(saved)
    $showAllProfiles.set(false)
    closeTerminal('profile-a-first')
    expect(model.allPaneIds(screens.$tabbedScreenTrees.get()['5'])).not.toContain(pane)
    expect(screens.tabbedScreenOwner('terminal-instance:profile-a-second')).toBe('5')
    $showAllProfiles.set(true)
    expect(registry.getArea('panes').some(p => p.id === pane)).toBe(false)
    expect($terminals.get()).toHaveLength(1)
  }
)

it('retains scoped-out terminal placement when the mirror first restores', async () => {
  const { screens, model, registry } = await setup()
  const { $terminals, closeTerminal } = await import('@/app/right-sidebar/terminal/terminals')
  const { watchTerminalPanes } = await import('@/app/right-sidebar/terminal/panes')
  const { $activeGatewayProfile, $showAllProfiles } = await import('@/store/profile')
  $activeGatewayProfile.set('b')
  $showAllProfiles.set(false)
  $terminals.set([{ id: 'saved-a', profile: 'a', kind: 'user', title: 'Saved', auto: false, cwd: '/tmp' }])
  const pane = 'terminal-instance:saved-a'
  const saved = model.split('row', [model.group(['sessions']), model.group([pane]), model.group(['files'])])
  screens.$tabbedScreenTrees.set({ ...screens.$tabbedScreenTrees.get(), '5': saved })
  watchTerminalPanes()
  expect(screens.$tabbedScreenTrees.get()['5']).toEqual(saved)
  expect(registry.getArea('panes').some(p => p.id === pane)).toBe(false)
  closeTerminal('saved-a')
  expect(model.allPaneIds(screens.$tabbedScreenTrees.get()['5'])).not.toContain(pane)
})

it('retains an empty center after closing the last secondary-screen tab', async () => {
  const { store, model, registry } = await setup()
  store.setActiveTabbedScreen('2')

  const dispose = registry.register({
    id: 'session-tile:last',
    area: 'panes',
    data: { placement: 'main' },
    render: () => null
  })

  store.revealTreePane('session-tile:last')
  store.removeTreePane('session-tile:last')
  dispose()

  const tree = store.$layoutTree.get()!

  const emptyGroups = model
    .groupLeafIds(tree)
    .map(id => model.findGroup(tree, id)!)
    .filter(g => g.panes.length === 0)

  expect(emptyGroups).toHaveLength(1)
  expect(model.allPaneIds(tree)).toEqual(['sessions', 'files'])
})

it('moves a tab back into the center of an emptied desktop, not its sidebar', async () => {
  const { store, screens, model, registry } = await setup()
  // Legacy/default topology after the main group has been normalized away.
  screens.$tabbedScreenTrees.set({ ...screens.$tabbedScreenTrees.get(), '2': model.group(['sessions', 'files']) })
  registry.register({ id: 'session-tile:roundtrip', area: 'panes', data: { placement: 'main' }, render: () => null })
  store.revealTreePane('session-tile:roundtrip')
  store.moveTreePanesToTabbedScreen(['session-tile:roundtrip'], '2')
  store.moveTreePanesToTabbedScreen(['session-tile:roundtrip'], '3')
  store.moveTreePanesToTabbedScreen(['session-tile:roundtrip'], '2')

  const tree = store.$layoutTree.get()!
  expect(model.findGroupOfPane(tree, 'session-tile:roundtrip')!.panes).toEqual(['session-tile:roundtrip'])
  expect(model.findGroupOfPane(tree, 'sessions')!.id).not.toBe(
    model.findGroupOfPane(tree, 'session-tile:roundtrip')!.id
  )
  const source = screens.$tabbedScreenTrees.get()['3']
  expect(model.groupLeafIds(source).some(id => model.findGroup(source, id)!.panes.length === 0)).toBe(true)
})

it('repairs a persisted sidebar-only desktop on reload without adding a chat tab', async () => {
  const { model } = await setup()
  localStorage.setItem('hermes.desktop.tabbedScreens.active.v1', '3')
  localStorage.setItem(
    'hermes.desktop.tabbedScreens.trees.v1',
    JSON.stringify({ '3': model.group(['sessions', 'files']) })
  )
  vi.resetModules()
  const { $layoutTree } = await import('./store')
  const tree = $layoutTree.get()!
  expect(tree.type).toBe('split')
  expect(model.allPaneIds(tree)).toEqual(['sessions', 'files'])
  expect(model.groupLeafIds(tree).some(id => model.findGroup(tree, id)!.emptyWorkspace)).toBe(true)
  expect(model.isLayoutNode(tree)).toBe(true)
})

it('switches independent tab/panel sets and restores their split geometry', async () => {
  const { store, model, registry } = await setup()
  const first = store.$layoutTree.get()
  store.setActiveTabbedScreen('2')
  expect(model.allPaneIds(store.$layoutTree.get()!)).toEqual(['sessions', 'files'])
  registry.register({ id: 'session-tile:second', area: 'panes', data: { placement: 'main' }, render: () => null })
  store.revealTreePane('session-tile:second')
  const second = store.$layoutTree.get()
  expect(model.allPaneIds(second!)).toEqual(['sessions', 'session-tile:second', 'files'])
  store.setActiveTabbedScreen('1')
  expect(store.$layoutTree.get()).toEqual(first)
  store.setActiveTabbedScreen('2')
  expect(store.$layoutTree.get()).toEqual(second)
})

it('reveals existing panes on their owning screen without copying them', async () => {
  const { store, screens, model } = await setup()
  store.setActiveTabbedScreen('2')
  store.revealTreePane('files')
  expect(screens.$activeTabbedScreen.get()).toBe('2')
  expect(model.allPaneIds(store.$layoutTree.get()!)).toEqual(['sessions', 'files'])
  expect(model.allPaneIds(screens.$tabbedScreenTrees.get()['2'])).toEqual(['sessions', 'files'])
})

it('keeps other screen panes out of startup adoption and restores after reload', async () => {
  const { store, model, initial } = await setup()
  store.setActiveTabbedScreen('2')
  store.declareDefaultTree(initial)
  expect(model.allPaneIds(store.$layoutTree.get()!)).toEqual(['sessions', 'files'])
  vi.resetModules()
  const restored = await import('./store')
  expect(model.allPaneIds(restored.$layoutTree.get()!)).toEqual(['sessions', 'files'])
  restored.setActiveTabbedScreen('1')
  expect(model.allPaneIds(restored.$layoutTree.get()!)).toEqual(['sessions', 'workspace', 'files'])
})

it('cycles screens and keeps the tabbed tree through a layout mode roundtrip', async () => {
  const { store, screens } = await setup()
  const { setLayoutSurfaceMode } = await import('./scroll-windows/store')
  store.cycleTabbedScreen(-1)
  expect(screens.$activeTabbedScreen.get()).toBe('5')
  const last = store.$layoutTree.get()
  setLayoutSurfaceMode('scroll-windows')
  setLayoutSurfaceMode('tabbed')
  expect(store.$layoutTree.get()).toEqual(last)
  store.cycleTabbedScreen(1)
  expect(screens.$activeTabbedScreen.get()).toBe('1')
})

it('does not count the empty workspace placeholder as a tabbed-screen tab', async () => {
  const { initial } = await setup()
  const { tabbedScreenPaneCount } = await import('./scroll-windows/titlebar')

  expect(tabbedScreenPaneCount(initial, true, new Set(['workspace']))).toBe(0)
  expect(tabbedScreenPaneCount(initial, false, new Set(['workspace']))).toBe(1)
})

it('does not count hidden terminal tabs or stale unregistered pane ids', async () => {
  const { model } = await setup()
  const { tabbedScreenPaneCount } = await import('./scroll-windows/titlebar')
  const tree = model.group(['sessions', 'files', 'terminal-instance:hidden', 'terminal-instance:deleted'])
  expect(tabbedScreenPaneCount(tree, false, new Set())).toBe(0)
  expect(tabbedScreenPaneCount(tree, false, new Set(['terminal-instance:hidden']))).toBe(1)
})

it('moves a tab to another numbered screen', async () => {
  const { store, screens, model, registry } = await setup()
  registry.register({ id: 'session-tile:first', area: 'panes', data: { placement: 'main' }, render: () => null })
  store.revealTreePane('session-tile:first')

  store.moveTreePanesToTabbedScreen(['session-tile:first'], '2')

  expect(screens.$activeTabbedScreen.get()).toBe('2')
  expect(model.allPaneIds(screens.$tabbedScreenTrees.get()['1'])).toEqual(['sessions', 'workspace', 'files'])
  expect(model.allPaneIds(store.$layoutTree.get()!)).toEqual(['sessions', 'session-tile:first', 'files'])
})

it('moves a tab from its owning screen after the user switches during a drag', async () => {
  const { store, screens, model, registry } = await setup()
  registry.register({ id: 'session-tile:first', area: 'panes', data: { placement: 'main' }, render: () => null })
  store.revealTreePane('session-tile:first')
  store.setActiveTabbedScreen('2')

  store.moveTreePanesToTabbedScreen(['session-tile:first'], '3')

  expect(screens.$activeTabbedScreen.get()).toBe('3')
  expect(model.allPaneIds(screens.$tabbedScreenTrees.get()['1'])).toEqual(['sessions', 'workspace', 'files'])
  expect(model.allPaneIds(store.$layoutTree.get()!)).toEqual(['sessions', 'session-tile:first', 'files'])
})
