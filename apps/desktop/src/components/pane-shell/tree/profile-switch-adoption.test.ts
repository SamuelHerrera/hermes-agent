import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

// Exercise real profile hydration, pane mirroring, and layout adoption. No
// gateway is needed: the reported failure occurs before the chat can mount.
async function setup(park: boolean, withSidebar = true) {
  const tree = await import('./store')
  const model = await import('./model')
  const { registry } = await import('@/contrib/registry')
  const session = await import('@/store/session')
  const states = await import('@/store/session-states')
  const profile = await import('@/store/profile')
  const { paneMirror } = await import('@/app/chat/pane-mirror')

  const panes = [
    ...(withSidebar ? [['sessions', 'left']] : []),
    ['workspace', 'main'],
    ['files', 'right']
  ]

  for (const [id, placement] of panes) {
    registry.register({ id, area: 'panes', data: { placement }, render: () => null })
  }

  const defaultTree = model.split('row', panes.map(([id]) => model.group([id])))
  tree.declareDefaultTree(defaultTree)
  tree.watchContributedPanes()
  paneMirror({
    source: states.$sessionTiles,
    key: tile => tile.storedSessionId,
    prefix: 'session-tile',
    dir: tile => tile.dir,
    anchor: tile => tile.anchor,
    minWidth: '200px',
    title: key => key,
    render: () => null,
    close: states.closeSessionTile
  })()
  states.openSessionTile('saved-chat', 'right', 'workspace')
  expect(model.allPaneIds(tree.$layoutTree.get()!)).toContain('session-tile:saved-chat')

  if (park) {
    session.setWorkspaceEmptyPlaceholder(true)
    expect(tree.parkEmptyWorkspaceHost()).toBe(true)
    await Promise.resolve()
    expect(model.allPaneIds(tree.$layoutTree.get()!)).not.toContain('workspace')
  }

  async function roundtrip() {
    profile.$activeGatewayProfile.set('other-profile')
    await Promise.resolve()
    profile.$activeGatewayProfile.set('default')
    await Promise.resolve()
  }

  await roundtrip()

  return { tree, model, registry, states, session, defaultTree, roundtrip }
}

it('restores a profile tab when the workspace is still present', async () => {
  const { tree, model } = await setup(false)
  expect(model.allPaneIds(tree.$layoutTree.get()!)).toContain('session-tile:saved-chat')
})

it('restores parked profile tabs into a main group without taking over tool panels', async () => {
  const { tree, model, registry, states, session, roundtrip } = await setup(true)

  for (let attempt = 0; attempt < 3; attempt++) {
    expect(states.$sessionTiles.get().map(tile => tile.storedSessionId)).toEqual(['saved-chat'])
    expect(registry.getArea('panes').map(pane => pane.id)).toContain('session-tile:saved-chat')
    const layout = tree.$layoutTree.get()!
    const chat = model.findGroupOfPane(layout, 'session-tile:saved-chat')
    expect(chat?.active).toBe('session-tile:saved-chat')
    expect(model.findGroupOfPane(layout, 'sessions')?.panes).toEqual(['sessions'])
    expect(model.findGroupOfPane(layout, 'files')?.panes).toEqual(['files'])
    expect(session.$workspaceEmptyPlaceholder.get()).toBe(true)
    await roundtrip()
  }
})

it('recreates a main group even when only a tool panel remains', async () => {
  const { tree, model } = await setup(true, false)
  const layout = tree.$layoutTree.get()!
  expect(model.findGroupOfPane(layout, 'session-tile:saved-chat')?.active).toBe('session-tile:saved-chat')
  expect(model.findGroupOfPane(layout, 'files')?.panes).toEqual(['files'])
})

it('keeps restored tabs through the startup default-tree merge', async () => {
  const { tree, model, defaultTree } = await setup(true)
  tree.declareDefaultTree(defaultTree)
  await Promise.resolve()
  expect(model.allPaneIds(tree.$layoutTree.get()!)).toContain('session-tile:saved-chat')
})
