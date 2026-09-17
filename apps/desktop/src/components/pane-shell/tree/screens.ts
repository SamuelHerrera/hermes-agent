import { atom } from 'nanostores'

import { readJson, readKey, writeJson, writeKey } from '@/lib/storage'

import {
  allPaneIds,
  findGroup,
  findGroupOfPane,
  findParentSplit,
  group,
  groupLeafIds,
  insertAtGroup,
  isLayoutNode,
  type LayoutNode,
  normalize,
  removePane,
  replaceNode,
  split
} from './model'
import { SCROLL_WINDOW_WORKSPACE_IDS } from './scroll-windows/store'

const TREES_KEY = 'hermes.desktop.tabbedScreens.trees.v1'
const ACTIVE_KEY = 'hermes.desktop.tabbedScreens.active.v1'
const stored = readJson<Record<string, unknown>>(TREES_KEY) ?? {}

export const $tabbedScreenTrees = atom<Record<string, LayoutNode>>(
  Object.fromEntries(
    Object.entries(stored)
      .filter(
        (entry): entry is [string, LayoutNode] =>
          SCROLL_WINDOW_WORKSPACE_IDS.includes(entry[0]) && isLayoutNode(entry[1])
      )
      .map(([id, tree]) => [id, ensureTabbedScreenContent(tree)])
  )
)
const storedActive = readKey(ACTIVE_KEY) ?? '1'
export const $activeTabbedScreen = atom(SCROLL_WINDOW_WORKSPACE_IDS.includes(storedActive) ? storedActive : '1')

$tabbedScreenTrees.listen(trees => writeJson(TREES_KEY, trees))
$activeTabbedScreen.listen(id => writeKey(ACTIVE_KEY, id))

export function saveTabbedScreen(tree: LayoutNode): void {
  const id = $activeTabbedScreen.get()
  const trees = $tabbedScreenTrees.get()

  if (trees[id] !== tree) {
    $tabbedScreenTrees.set({ ...trees, [id]: tree })
  }
}

export function tabbedScreenOwner(paneId: string): string | undefined {
  if (paneId === 'sessions' || paneId === 'files') {
    return undefined
  }

  return Object.entries($tabbedScreenTrees.get()).find(([, tree]) => allPaneIds(tree).includes(paneId))?.[0]
}

/** Keep the shared navigation rail, but never duplicate the primary chat host. */
export function emptyTabbedScreen(tree: LayoutNode, screenId?: string): LayoutNode {
  return ensureTabbedScreenContent(cloneNavigation(tree, screenId))
}

function rightPanelAnchor(tree: LayoutNode) {
  return findGroupOfPane(tree, 'workspace') ?? findGroupOfPane(tree, 'sessions') ??
    groupLeafIds(tree).map(id => findGroup(tree, id)).find(group => group && !group.panes.includes('files')) ??
    null
}

function filesAlreadyRightOfAnchor(tree: LayoutNode): boolean {
  const files = findGroupOfPane(tree, 'files')

  if (!files || files.panes.includes('sessions') || files.panes.includes('workspace')) {
    return false
  }

  const parent = findParentSplit(tree, files.id)

  if (!parent || parent.orientation !== 'row') {
    return false
  }

  const filesIndex = parent.children.findIndex(child => child.id === files.id)
  const workspaceIndex = parent.children.findIndex(child => allPaneIds(child).includes('workspace'))

  const anchorIndex = workspaceIndex >= 0 ? workspaceIndex : parent.children.findIndex(child => {
    const panes = allPaneIds(child)

    return panes.includes('sessions')
  })

  return anchorIndex >= 0 && filesIndex > anchorIndex
}

/** Files is shared navigation chrome, but it must live in the right rail on
 * every numbered desktop. Persisted/custom trees can still carry older shapes
 * where Files was stacked into Sessions or the main tab strip; repair those at
 * every screen boundary so focusing desktop 1 cannot pull Files back left. */
export function enforceFilesRightPanel(tree: LayoutNode): LayoutNode {
  if (!findGroupOfPane(tree, 'files') || filesAlreadyRightOfAnchor(tree)) {
    return tree
  }

  const withoutFiles = removePane(tree, 'files')
  const anchor = withoutFiles ? rightPanelAnchor(withoutFiles) : null

  return anchor && withoutFiles ? (insertAtGroup(withoutFiles, anchor.id, 'files', 'right', undefined, false) ?? tree) : tree
}

function cloneNavigation(tree: LayoutNode, screenId?: string): LayoutNode {
  const id = screenId ? `${tree.id}:screen-${screenId}` : tree.id

  if (tree.type === 'group') {
    const panes = tree.panes.filter(id => id === 'sessions' || id === 'files')

    return { ...tree, id, panes, active: panes[0] ?? '' }
  }

  return { ...tree, id, children: tree.children.map(child => cloneNavigation(child, screenId)) }
}

/** Restore a real drop target and flex center without mounting another chat.
 * Normal structural operations still prune empty splits; only an entirely
 * empty desktop gets this one placeholder back. */
export function ensureTabbedScreenContent(tree: LayoutNode): LayoutNode {
  tree = enforceFilesRightPanel(tree)

  // Older/default screens can retain Files in the Sessions group after their
  // last content pane is closed. There need not be a primary workspace on this
  // desktop, so repair the rail independently of that permanent chat host.
  const sessions = findGroupOfPane(tree, 'sessions')

  if (sessions?.panes.includes('files')) {
    const withoutFiles = replaceNode(tree, sessions.id, () => ({
      ...sessions,
      panes: sessions.panes.filter(id => id !== 'files'),
      active: sessions.active === 'files' ? 'sessions' : sessions.active
    }))

    return ensureTabbedScreenContent(normalize(split('row', [withoutFiles, group(['files'])], [4.4, 1]))!)
  }

  if (allPaneIds(tree).some(id => id !== 'sessions' && id !== 'files')) {
    return tree
  }

  if (
    groupLeafIds(tree).some(id => {
      const node = findGroup(tree, id)!

      return node.emptyWorkspace && node.panes.length === 0
    })
  ) {
    return tree
  }

  const empty = group([], { emptyWorkspace: true })
  const navigation = normalize(tree)

  if (!navigation) {
    return empty
  }

  const sidebar = findGroupOfPane(navigation, 'sessions')

  return sidebar
    ? replaceNode(navigation, sidebar.id, node => split('row', [node, empty], [1, 3.4]))
    : split('row', [empty, navigation], [3.4, 1])
}
