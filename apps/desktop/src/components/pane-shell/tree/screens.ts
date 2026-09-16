import { atom } from 'nanostores'

import { readJson, readKey, writeJson, writeKey } from '@/lib/storage'

import {
  allPaneIds,
  findGroup,
  findGroupOfPane,
  group,
  groupLeafIds,
  isLayoutNode,
  type LayoutNode,
  normalize,
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
