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

  expect(tabbedScreenPaneCount(initial, true)).toBe(0)
  expect(tabbedScreenPaneCount(initial, false)).toBe(1)
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
