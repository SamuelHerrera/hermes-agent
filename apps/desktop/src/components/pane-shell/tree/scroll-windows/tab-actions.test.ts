import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

it.each(['others', 'right', 'all'] as const)('scopes close %s to the scroll desktop and visual order', async action => {
  const store = await import('../store')
  const scroll = await import('./store')
  const { group } = await import('../model')
  const { registry } = await import('@/contrib/registry')
  const ids = ['session-tile:a', 'session-tile:b', 'session-tile:c', 'session-tile:hidden']
  const closed: string[] = []

  for (const id of ids) {
    registry.register({ id, area: 'panes', data: { placement: 'main' }, render: () => null })
    store.registerPaneCloser(id, () => closed.push(id))
  }

  store.declareDefaultTree(group(ids))
  scroll.setLayoutSurfaceMode('scroll-windows')
  scroll.syncScrollWindowWindows(ids)
  scroll.moveScrollWindowToWorkspace(ids[2], '2')
  scroll.setActiveScrollWorkspace('1')
  scroll.reorderScrollWindowWindow(ids[1], ids[0], 'left')
  store.setTreePaneHidden(ids[3], true)
  expect(store.treeTabCloseTargets(ids[1])).toEqual({ all: 2, others: 1, right: 1 })
  const actions = { others: store.closeOtherTreeTabs, right: store.closeTreeTabsToRight, all: store.closeAllTreeTabs }
  actions[action](ids[1])
  expect(closed).toEqual(action === 'all' ? [ids[1], ids[0]] : [ids[0]])
})
