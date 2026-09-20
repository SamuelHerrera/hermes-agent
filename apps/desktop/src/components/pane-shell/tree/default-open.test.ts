import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

async function setup() {
  const tree = await import('./store')
  const model = await import('./model')
  const { registry } = await import('@/contrib/registry')
  const preview = await import('@/store/preview')
  const { watchPreviewTiles } = await import('@/app/chat/preview-tile')

  for (const [id, placement] of [['sessions', 'left'], ['workspace', 'main'], ['caller', 'main'], ['files', 'right']]) {
    registry.register({ id, area: 'panes', data: { placement }, render: () => null })
  }

  tree.declareDefaultTree(model.split('row', ['sessions', 'workspace', 'caller', 'files'].map(id => model.group([id]))))
  tree.watchContributedPanes()
  watchPreviewTiles()
  const groupOf = (id: string) => model.findGroupOfPane(tree.$layoutTree.get()!, id)!
  tree.noteActiveTreeGroup(groupOf('caller').id)

  return { tree, model, preview, groupOf }
}

it('opens a new file as a tab in the focused panel without splitting', async () => {
  const { tree, model, preview, groupOf } = await setup()
  const before = model.groupLeafIds(tree.$layoutTree.get()!)
  preview.openPreview({ kind: 'file', label: 'Notes', path: '/tmp/notes.md', source: '/tmp/notes.md', url: 'file:///tmp/notes.md' })
  expect(groupOf('preview-tile:file:file:///tmp/notes.md').id).toBe(groupOf('caller').id)
  expect(model.groupLeafIds(tree.$layoutTree.get()!)).toEqual(before)
})

it('opens a page in the focused panel and still honors an explicit split', async () => {
  const { tree, model, groupOf } = await setup()
  const { openRouteTile } = await import('@/store/route-tiles')
  const { watchRouteTiles } = await import('@/app/chat/route-tile')
  watchRouteTiles()
  const before = model.groupLeafIds(tree.$layoutTree.get()!).length
  openRouteTile('/skills')
  expect(groupOf('route-tile:/skills').id).toBe(groupOf('caller').id)
  expect(model.groupLeafIds(tree.$layoutTree.get()!)).toHaveLength(before)
  openRouteTile('/artifacts', 'right')
  expect(groupOf('route-tile:/artifacts').id).not.toBe(groupOf('caller').id)
  expect(model.groupLeafIds(tree.$layoutTree.get()!)).toHaveLength(before + 1)
})

it('opens ordinary session tabs in the focused panel even if it is not a chat panel', async () => {
  const { groupOf } = await setup()
  const states = await import('@/store/session-states')
  const { paneMirror } = await import('@/app/chat/pane-mirror')
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
  states.openSessionTile('new-chat')
  expect(groupOf('session-tile:new-chat').id).toBe(groupOf('caller').id)
})

it('keeps the caller captured before an async open even after focus moves', async () => {
  const { tree, preview, groupOf } = await setup()
  const anchor = tree.defaultOpenPaneAnchor('caller')
  tree.noteActiveTreeGroup(groupOf('workspace').id)
  preview.openPreview({ kind: 'url', label: 'Example', source: 'https://example.com', url: 'https://example.com' }, 'tool-result', anchor)
  expect(groupOf(`preview-tile:${preview.$previewTabs.get()[0].id}`).id).toBe(groupOf('caller').id)
})

it('opens files in the file browser caller panel without another split', async () => {
  const { tree, model, preview, groupOf } = await setup()
  const before = model.groupLeafIds(tree.$layoutTree.get()!)
  preview.openPreview({ kind: 'file', label: 'File', source: '/tmp/file.md', url: 'file:///tmp/file.md' }, 'file-browser', 'files')
  expect(groupOf('preview-tile:file:file:///tmp/file.md').id).toBe(groupOf('files').id)
  expect(model.groupLeafIds(tree.$layoutTree.get()!)).toEqual(before)
})

it('uses the last focused content panel for sidebar actions, not hover', async () => {
  const { tree, preview, groupOf } = await setup()
  tree.noteHoveredTreeGroup(groupOf('workspace').id)
  tree.noteActiveTreeGroup(groupOf('sessions').id)
  preview.openPreview({ kind: 'artifact', label: 'Artifact', source: 'artifact:a', url: 'artifact:a' })
  expect(groupOf('preview-tile:artifact:artifact:a').id).toBe(groupOf('caller').id)
  expect(groupOf('sessions').panes).toEqual(['sessions'])
})

it('opens new terminals in the focused panel', async () => {
  const { groupOf } = await setup()
  const { watchTerminalPanes } = await import('@/app/right-sidebar/terminal/panes')
  const { createTerminal } = await import('@/app/right-sidebar/terminal/terminals')
  watchTerminalPanes()
  const id = createTerminal('/tmp')
  expect(groupOf(`terminal-instance:${id}`).id).toBe(groupOf('caller').id)
})

it('keeps an existing preview where the user explicitly moved it', async () => {
  const { tree, preview, groupOf } = await setup()
  const target = { kind: 'url' as const, label: 'Example', source: 'https://example.com', url: 'https://example.com' }
  preview.openPreview(target)
  const pane = `preview-tile:${preview.$previewTabs.get()[0].id}`
  tree.moveTreePane(pane, { groupId: groupOf('workspace').id, pos: 'right' })
  const placedGroup = groupOf(pane).id
  tree.noteActiveTreeGroup(groupOf('caller').id)
  preview.openPreview(target)
  expect(groupOf(pane).id).toBe(placedGroup)
})

it('uses the existing empty panel on a new desktop rather than adding a split', async () => {
  const { tree, model, preview } = await setup()
  tree.setActiveTabbedScreen('2')
  const before = model.groupLeafIds(tree.$layoutTree.get()!)
  preview.openPreview({ kind: 'file', label: 'File', source: '/tmp/empty.md', url: 'file:///tmp/empty.md' })
  expect(model.groupLeafIds(tree.$layoutTree.get()!)).toEqual(before)
})
