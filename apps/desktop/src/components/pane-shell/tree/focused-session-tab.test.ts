import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ⌘W / ⌘T / ⌘⇧T / the strip "+" used to hardcode the workspace's zone while
// ⌘1…⌘9 followed the interacted zone — so every tab verb missed a SECOND chat
// zone the user was working in. They now resolve the same focused zone.

describe('focused chat zone drives the tab verbs', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  async function setup() {
    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')
    const { registry } = await import('@/contrib/registry')

    for (const id of ['workspace', 'files', 'session-tile:a', 'session-tile:b', 'route-tile:/kanban']) {
      registry.register({
        area: 'panes',
        data: id === 'workspace' ? { placement: 'main', uncloseable: true } : { placement: 'main' },
        id,
        render: () => null,
        title: id
      })
    }

    // Two chat zones side by side: main holds the workspace, the second holds
    // its own session tabs (a split-off stack).
    tree.declareDefaultTree(
      model.split('row', [
        model.group(['workspace'], { active: 'workspace', id: 'grp-main' }),
        model.group(['session-tile:a', 'session-tile:b'], { active: 'session-tile:b', id: 'grp-side' })
      ])
    )

    return { model, tree }
  }

  it('⌘T anchors the new tab to the focused zone, not always the workspace', async () => {
    const { tree } = await setup()

    tree.noteActiveTreeGroup('grp-side')
    expect(tree.focusedSessionTabAnchor()).toBe('session-tile:b')

    tree.noteActiveTreeGroup('grp-main')
    expect(tree.focusedSessionTabAnchor()).toBe('workspace')
  })

  it('a non-chat zone (files/terminal focus) falls back to the workspace', async () => {
    const { model, tree } = await setup()

    tree.declareDefaultTree(
      model.split('row', [
        model.group(['workspace'], { active: 'workspace', id: 'grp-main' }),
        model.group(['files'], { active: 'files', id: 'grp-files' })
      ])
    )
    tree.noteActiveTreeGroup('grp-files')

    expect(tree.focusedSessionTabAnchor()).toBe('workspace')
    // ⌘W must not close the file tree just because it holds focus.
    expect(tree.closeFocusedSessionTab()).toBe(false)
  })

  it('⌘W closes the focused zone active tab and leaves the workspace alone', async () => {
    const { model, tree } = await setup()

    tree.noteActiveTreeGroup('grp-side')
    expect(tree.closeFocusedSessionTab()).toBe(true)
    expect(model.allPaneIds(tree.$layoutTree.get()!)).not.toContain('session-tile:b')

    // Back on main: the uncloseable workspace is a no-op (the caller promotes
    // a stacked session instead of closing the window).
    tree.noteActiveTreeGroup('grp-main')
    expect(tree.closeFocusedSessionTab()).toBe(false)
    expect(model.allPaneIds(tree.$layoutTree.get()!)).toContain('workspace')
  })

  it('plain tab activation restores a main strip hidden by a stale lone-tab close', async () => {
    const { model, tree } = await setup()

    tree.$layoutTree.set(
      model.group(['workspace', 'session-tile:a'], {
        active: 'workspace',
        headerHidden: true,
        id: 'grp-main'
      })
    )

    tree.activateTreePane('grp-main', 'session-tile:a')

    const group = model.findGroup(tree.$layoutTree.get()!, 'grp-main')

    expect(group?.active).toBe('session-tile:a')
    expect(group?.headerHidden).toBe(false)
  })

  it('Close all empties the store-owned workspace tab without removing its pane', async () => {
    const { model, tree } = await setup()
    const closed: string[] = []

    tree.registerPaneCloser('workspace', () => {
      closed.push('workspace')
      tree.hideLoneTreeTab('workspace')
    })
    tree.registerPaneCloser('session-tile:a', () => {
      closed.push('session-tile:a')
      tree.dismissTreePane('session-tile:a')
    })
    tree.moveTreePane('session-tile:a', { groupId: 'grp-main', pos: 'center' })

    expect(tree.treeTabCloseTargets('session-tile:a').all).toBe(2)

    tree.closeAllTreeTabs('session-tile:a')

    expect(closed).toEqual(['session-tile:a', 'workspace'])
    // Workspace is a permanent rendering host. Closing its TAB is routed to
    // the owner above; the pane remains while its now-empty strip disappears.
    expect(model.allPaneIds(tree.$layoutTree.get()!)).toContain('workspace')
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'workspace')?.headerHidden).toBe(true)
  })

  it('Close all can close every session/page tab in sequence and leave only the empty workspace host', async () => {
    const { model, tree } = await setup()
    const closed: string[] = []

    for (const id of ['session-tile:a', 'route-tile:/kanban', 'session-tile:b']) {
      tree.registerPaneCloser(id, () => {
        closed.push(id)
        tree.dismissTreePane(id)
      })
    }

    tree.registerPaneCloser('workspace', () => {
      closed.push('workspace')
      tree.hideLoneTreeTab('workspace')
    })
    tree.$layoutTree.set(
      model.group(['workspace', 'session-tile:a', 'route-tile:/kanban', 'session-tile:b'], {
        active: 'route-tile:/kanban',
        id: 'grp-main'
      })
    )

    expect(tree.treeTabCloseTargets('route-tile:/kanban').all).toBe(4)

    tree.closeAllTreeTabs('route-tile:/kanban')

    expect(closed).toEqual(['session-tile:a', 'route-tile:/kanban', 'session-tile:b', 'workspace'])
    expect(model.allPaneIds(tree.$layoutTree.get()!)).toEqual(['workspace'])
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'workspace')?.headerHidden).toBe(true)
  })

  // Preview/page tiles share `placement: 'main'` but not the session-tile id
  // prefix — the generic tab verbs must serve their zones too, or ⌘W over a
  // lone Browser tile falls through and empties MAIN instead.
  it('⌘W and ⌃Tab serve a zone of preview/page tiles like any tab strip', async () => {
    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')
    const { registry } = await import('@/contrib/registry')

    for (const id of ['workspace', 'preview-tile:url:x', 'route-tile:/skills']) {
      registry.register({
        area: 'panes',
        data: id === 'workspace' ? { placement: 'main', uncloseable: true } : { placement: 'main' },
        id,
        render: () => null,
        title: id
      })
    }

    const closed: string[] = []

    tree.registerPaneCloser('preview-tile:url:x', () => closed.push('preview-tile:url:x'))
    tree.declareDefaultTree(
      model.split('row', [
        model.group(['workspace'], { active: 'workspace', id: 'grp-main' }),
        model.group(['preview-tile:url:x', 'route-tile:/skills'], { active: 'preview-tile:url:x', id: 'grp-view' })
      ])
    )
    tree.noteActiveTreeGroup('grp-view')

    // ⌃Tab cycles within the preview zone, not main's.
    expect(tree.cycleTreeTabInFocusedZone(1)).toBe('route-tile:/skills')
    expect(tree.$layoutTree.get() && model.findGroup(tree.$layoutTree.get()!, 'grp-view')?.active).toBe(
      'route-tile:/skills'
    )

    // ⌘W closes the zone's active tab through its registered closer.
    tree.cycleTreeTabInFocusedZone(1)
    expect(tree.closeFocusedSessionTab()).toBe(true)
    expect(closed).toEqual(['preview-tile:url:x'])
  })
})
