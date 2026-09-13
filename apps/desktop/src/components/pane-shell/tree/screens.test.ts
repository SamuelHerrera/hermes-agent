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

it('switches independent tab/panel sets and restores their split geometry', async () => {
  const { store, model, registry } = await setup()
  const first = store.$layoutTree.get()
  store.setActiveTabbedScreen('2')
  expect(model.allPaneIds(store.$layoutTree.get()!)).toEqual(['sessions'])
  registry.register({ id: 'session-tile:second', area: 'panes', data: { placement: 'main' }, render: () => null })
  store.revealTreePane('session-tile:second')
  const second = store.$layoutTree.get()
  expect(model.allPaneIds(second!)).toEqual(['sessions', 'session-tile:second'])
  store.setActiveTabbedScreen('1')
  expect(store.$layoutTree.get()).toEqual(first)
  store.setActiveTabbedScreen('2')
  expect(store.$layoutTree.get()).toEqual(second)
})

it('reveals existing panes on their owning screen without copying them', async () => {
  const { store, screens, model } = await setup()
  store.setActiveTabbedScreen('2')
  store.revealTreePane('files')
  expect(screens.$activeTabbedScreen.get()).toBe('1')
  expect(model.allPaneIds(screens.$tabbedScreenTrees.get()['2'])).toEqual(['sessions'])
})

it('keeps other screen panes out of startup adoption and restores after reload', async () => {
  const { store, model, initial } = await setup()
  store.setActiveTabbedScreen('2')
  store.declareDefaultTree(initial)
  expect(model.allPaneIds(store.$layoutTree.get()!)).toEqual(['sessions'])
  vi.resetModules()
  const restored = await import('./store')
  expect(model.allPaneIds(restored.$layoutTree.get()!)).toEqual(['sessions'])
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
