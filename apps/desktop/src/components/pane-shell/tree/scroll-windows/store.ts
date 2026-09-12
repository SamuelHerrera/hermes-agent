import { atom } from 'nanostores'

import { readJson, readKey, writeJson, writeKey } from '@/lib/storage'

import { legacyColumns, moveColumnWindow, reconcileColumns, type ScrollDropEdge } from './columns'
import type { ScrollGridLayout } from './grid'

export type LayoutSurfaceMode = 'tabbed' | 'scroll-windows'

export interface ScrollWindowWorkspaceState {
  id: string
  windowIds: string[]
  focusedWindowId: null | string
  columns: string[][]
  scrollLeft: number
  scrollTop: number
  grid: ScrollGridLayout | null
}

const MODE_KEY = 'hermes.desktop.layoutSurfaceMode.v1'
const WORKSPACES_KEY = 'hermes.desktop.scrollWindows.workspaces.v1'
const ACTIVE_WORKSPACE_KEY = 'hermes.desktop.scrollWindows.activeWorkspace.v1'
export const SCROLL_WINDOW_WORKSPACE_COUNT = 5
export const SCROLL_WINDOW_WORKSPACE_IDS = Array.from({ length: SCROLL_WINDOW_WORKSPACE_COUNT }, (_, index) =>
  String(index + 1)
)
export const $scrollWindowRevealRequest = atom<string | null>(null)

function validMode(value: string | null): LayoutSurfaceMode {
  return value === 'scroll-windows' ? 'scroll-windows' : 'tabbed'
}

function emptyWorkspace(id: string): ScrollWindowWorkspaceState {
  return { focusedWindowId: null, grid: null, id, columns: [], scrollLeft: 0, scrollTop: 0, windowIds: [] }
}

function coerceWorkspace(value: unknown, id: string): ScrollWindowWorkspaceState {
  if (!value || typeof value !== 'object') {
    return emptyWorkspace(id)
  }

  const raw = value as Partial<ScrollWindowWorkspaceState> & { rowCount?: number }

  const windowIds = Array.isArray(raw.windowIds)
    ? raw.windowIds.filter((item): item is string => typeof item === 'string')
    : []

  const focusedWindowId =
    typeof raw.focusedWindowId === 'string' && windowIds.includes(raw.focusedWindowId)
      ? raw.focusedWindowId
      : (windowIds[0] ?? null)

  const scrollLeft =
    typeof raw.scrollLeft === 'number' && Number.isFinite(raw.scrollLeft) ? Math.max(0, raw.scrollLeft) : 0

  const scrollTop = typeof raw.scrollTop === 'number' && Number.isFinite(raw.scrollTop) ? Math.max(0, raw.scrollTop) : 0
  const rowCount = typeof raw.rowCount === 'number' && Number.isFinite(raw.rowCount) ? Math.max(1, raw.rowCount) : 1

  const columns = reconcileColumns(
    Array.isArray(raw.columns)
      ? raw.columns.filter(Array.isArray).map(column => column.filter((id): id is string => typeof id === 'string'))
      : legacyColumns(windowIds, rowCount),
    windowIds
  )

  return {
    focusedWindowId,
    grid: null,
    id,
    columns,
    scrollLeft,
    scrollTop,
    windowIds: columns.flat()
  }
}

function loadWorkspaces(): ScrollWindowWorkspaceState[] {
  const raw = readJson<unknown[]>(WORKSPACES_KEY)

  return SCROLL_WINDOW_WORKSPACE_IDS.map(id =>
    coerceWorkspace(
      raw?.find(item => (item as { id?: unknown })?.id === id),
      id
    )
  )
}

function persistWorkspaces(workspaces: readonly ScrollWindowWorkspaceState[]): void {
  writeJson(
    WORKSPACES_KEY,
    workspaces.map(({ focusedWindowId, id, columns, scrollLeft, scrollTop, windowIds }) => ({
      focusedWindowId,
      id,
      columns,
      scrollLeft,
      scrollTop,
      windowIds
    }))
  )
}

export const $layoutSurfaceMode = atom<LayoutSurfaceMode>(validMode(readKey(MODE_KEY)))
const storedActiveWorkspaceId = readKey(ACTIVE_WORKSPACE_KEY)

export const $activeScrollWorkspaceId = atom<string>(
  SCROLL_WINDOW_WORKSPACE_IDS.includes(storedActiveWorkspaceId ?? '') ? storedActiveWorkspaceId! : '1'
)
export const $scrollWindowWorkspaces = atom<ScrollWindowWorkspaceState[]>(loadWorkspaces())

$layoutSurfaceMode.listen(mode => writeKey(MODE_KEY, mode === 'tabbed' ? null : mode))
$activeScrollWorkspaceId.listen(id => writeKey(ACTIVE_WORKSPACE_KEY, id === '1' ? null : id))
$scrollWindowWorkspaces.listen(persistWorkspaces)

function updateWorkspace(id: string, fn: (workspace: ScrollWindowWorkspaceState) => ScrollWindowWorkspaceState): void {
  const current = $scrollWindowWorkspaces.get()
  let changed = false

  const next = current.map(workspace => {
    if (workspace.id !== id) {
      return workspace
    }

    const updated = fn(workspace)
    changed ||= updated !== workspace

    return updated
  })

  if (changed) {
    $scrollWindowWorkspaces.set(next)
  }
}

export function setLayoutSurfaceMode(mode: LayoutSurfaceMode): void {
  $layoutSurfaceMode.set(mode)
}

export function toggleLayoutSurfaceMode(): void {
  setLayoutSurfaceMode($layoutSurfaceMode.get() === 'tabbed' ? 'scroll-windows' : 'tabbed')
}

export function setActiveScrollWorkspace(id: string): void {
  if (SCROLL_WINDOW_WORKSPACE_IDS.includes(id)) {
    $activeScrollWorkspaceId.set(id)
  }
}

export function cycleScrollWorkspace(direction: 1 | -1): void {
  const current = $activeScrollWorkspaceId.get()
  const index = Math.max(0, SCROLL_WINDOW_WORKSPACE_IDS.indexOf(current))

  const next =
    SCROLL_WINDOW_WORKSPACE_IDS[
      (index + direction + SCROLL_WINDOW_WORKSPACE_IDS.length) % SCROLL_WINDOW_WORKSPACE_IDS.length
    ]

  setActiveScrollWorkspace(next)
}

export function syncScrollWindowWindows(availableWindowIds: readonly string[]): void {
  const available = [...new Set(availableWindowIds)]
  const availableSet = new Set(available)
  const assigned = new Set<string>()
  const activeId = $activeScrollWorkspaceId.get()
  let changed = false

  const next = $scrollWindowWorkspaces.get().map(workspace => {
    const windowIds = workspace.windowIds.filter(id => availableSet.has(id) && !assigned.has(id))

    windowIds.forEach(id => assigned.add(id))

    const focusedWindowId =
      workspace.focusedWindowId && windowIds.includes(workspace.focusedWindowId)
        ? workspace.focusedWindowId
        : (windowIds[0] ?? null)

    if (windowIds.length !== workspace.windowIds.length || focusedWindowId !== workspace.focusedWindowId) {
      changed = true

      return {
        ...workspace,
        focusedWindowId,
        columns: reconcileColumns(workspace.columns, windowIds),
        windowIds
      }
    }

    return workspace
  })

  const missing = available.filter(id => !assigned.has(id))

  if (missing.length > 0) {
    const targetIndex = next.findIndex(workspace => workspace.id === activeId)
    const workspace = next[targetIndex] ?? next[0]

    next[targetIndex >= 0 ? targetIndex : 0] = {
      ...workspace,
      focusedWindowId: workspace.focusedWindowId ?? missing[0],
      windowIds: [...workspace.windowIds, ...missing],
      columns: [...workspace.columns, ...missing.map(id => [id])]
    }
    changed = true
  }

  if (changed) {
    $scrollWindowWorkspaces.set(next)
  }
}

export function focusScrollWindowWindow(windowId: string): void {
  const workspaceId = $activeScrollWorkspaceId.get()

  updateWorkspace(workspaceId, workspace =>
    workspace.windowIds.includes(windowId) && workspace.focusedWindowId !== windowId
      ? { ...workspace, focusedWindowId: windowId }
      : workspace
  )
}

export function reorderScrollWindowWindow(
  sourceWindowId: string,
  targetWindowId: string,
  edge: ScrollDropEdge = 'left'
): void {
  if (sourceWindowId === targetWindowId) {
    return
  }

  const workspaceId = $activeScrollWorkspaceId.get()

  updateWorkspace(workspaceId, workspace => {
    const sourceIndex = workspace.windowIds.indexOf(sourceWindowId)
    const targetIndex = workspace.windowIds.indexOf(targetWindowId)

    if (sourceIndex < 0 || targetIndex < 0) {
      return workspace
    }

    const columns = moveColumnWindow(workspace.columns, sourceWindowId, targetWindowId, edge)

    return { ...workspace, focusedWindowId: sourceWindowId, columns, windowIds: columns.flat() }
  })
}

export function cycleScrollWindowFocus(direction: 1 | -1): void {
  const workspace = $scrollWindowWorkspaces.get().find(item => item.id === $activeScrollWorkspaceId.get())

  if (!workspace || workspace.windowIds.length === 0) {
    return
  }

  const index = Math.max(0, workspace.windowIds.indexOf(workspace.focusedWindowId ?? workspace.windowIds[0]))
  const next = workspace.windowIds[(index + direction + workspace.windowIds.length) % workspace.windowIds.length]

  focusScrollWindowWindow(next)
  requestScrollWindowIntoView(next)
}

export function setScrollWorkspaceScroll(id: string, scrollLeft: number, scrollTop: number): void {
  const nextLeft = Math.max(0, scrollLeft)
  const nextTop = Math.max(0, scrollTop)

  updateWorkspace(id, workspace =>
    Math.abs(workspace.scrollLeft - nextLeft) < 1 && Math.abs(workspace.scrollTop - nextTop) < 1
      ? workspace
      : {
          ...workspace,
          scrollLeft: nextLeft,
          scrollTop: nextTop
        }
  )
}

export function setScrollWorkspaceGrid(id: string, grid: ScrollGridLayout | null): void {
  updateWorkspace(id, workspace => ({ ...workspace, grid }))
}

export function requestScrollWindowIntoView(windowId: string): void {
  if ($layoutSurfaceMode.get() === 'scroll-windows') {
    $scrollWindowRevealRequest.set(windowId)
  }
}
