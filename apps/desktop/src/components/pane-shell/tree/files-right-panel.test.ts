import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutNode } from './model'

describe('Files right panel enforcement', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  async function setup() {
    const tree = await import('@/components/pane-shell/tree/store')
    const screens = await import('@/components/pane-shell/tree/screens')
    const model = await import('@/components/pane-shell/tree/model')
    const { registry } = await import('@/contrib/registry')

    registry.registerMany([
      { id: 'sessions', area: 'panes', data: { placement: 'left' }, render: () => null, title: 'Sessions' },
      { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null, title: 'Chat' },
      { id: 'files', area: 'panes', data: { placement: 'right' }, render: () => null, title: 'Files' }
    ])

    const expectFilesRightOfWorkspace = (layout: LayoutNode) => {
      const files = model.findGroupOfPane(layout, 'files')
      expect(files?.panes).toContain('files')
      expect(files?.panes).not.toContain('sessions')
      expect(files?.panes).not.toContain('workspace')
      const sessions = model.findGroupOfPane(layout, 'sessions')
      expect(sessions?.panes).toEqual(['sessions'])
      const parent = files ? model.findParentSplit(layout, files.id) : null
      expect(parent?.orientation).toBe('row')
      const filesIndex = parent?.children.findIndex((child: LayoutNode) => child.id === files?.id) ?? -1
      const workspaceIndex = parent?.children.findIndex((child: LayoutNode) => model.allPaneIds(child).includes('workspace')) ?? -1
      expect(workspaceIndex).toBeGreaterThanOrEqual(0)
      expect(filesIndex).toBeGreaterThan(workspaceIndex)
    }

    return { expectFilesRightOfWorkspace, model, screens, tree }
  }

  it('repairs shipped and persisted trees that still stack Files with Sessions', async () => {
    const { expectFilesRightOfWorkspace, model, tree } = await setup()

    tree.declareDefaultTree(
      model.split('row', [model.group(['sessions', 'files'], { id: 'grp-sessions' }), model.group(['workspace'], { id: 'grp-main' })])
    )

    expectFilesRightOfWorkspace(tree.$layoutTree.get()!)
  })

  it('keeps Files out of the main tab strip even after a user move', async () => {
    const { expectFilesRightOfWorkspace, model, tree } = await setup()

    tree.declareDefaultTree(
      model.split('row', [model.group(['sessions']), model.group(['workspace']), model.group(['files'])])
    )

    const workspace = model.findGroupOfPane(tree.$layoutTree.get()!, 'workspace')!
    tree.moveTreePane('files', { groupId: workspace.id, pos: 'center' })

    expectFilesRightOfWorkspace(tree.$layoutTree.get()!)
  })

  it('moves a lone Files group that was saved left of the workspace back to the right', async () => {
    const { expectFilesRightOfWorkspace, model, tree } = await setup()

    tree.declareDefaultTree(
      model.split('row', [model.group(['sessions']), model.group(['files']), model.group(['workspace'])])
    )

    expectFilesRightOfWorkspace(tree.$layoutTree.get()!)
  })

  it('allows other right-rail tabs to share the Files group', async () => {
    const { expectFilesRightOfWorkspace, model, tree } = await setup()

    tree.declareDefaultTree(
      model.split('row', [model.group(['sessions']), model.group(['workspace']), model.group(['files', 'right-preview'])])
    )

    expectFilesRightOfWorkspace(tree.$layoutTree.get()!)
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')?.panes).toContain('right-preview')
  })

  it('repairs desktop 1 when switching back from another numbered desktop', async () => {
    const { expectFilesRightOfWorkspace, model, screens, tree } = await setup()

    tree.declareDefaultTree(
      model.split('row', [model.group(['sessions']), model.group(['workspace']), model.group(['files'])])
    )
    tree.setActiveTabbedScreen('2')
    screens.$tabbedScreenTrees.set({
      ...screens.$tabbedScreenTrees.get(),
      '1': model.split('row', [
        model.group(['sessions'], { id: 'grp-sessions' }),
        model.group(['workspace', 'files'], { active: 'files', id: 'grp-main' })
      ])
    })

    tree.setActiveTabbedScreen('1')

    expectFilesRightOfWorkspace(tree.$layoutTree.get()!)
  })
})
