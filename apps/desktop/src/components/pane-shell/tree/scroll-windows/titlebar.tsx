import { useStore } from '@nanostores/react'
import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useContributions } from '@/contrib/react/use-contributions'
import { cn } from '@/lib/utils'
import { $fileBrowserOpen, setFileBrowserOpen, toggleFileBrowserOpen } from '@/store/layout'
import { $workspaceEmptyPlaceholder } from '@/store/session'

import { allPaneIds, type LayoutNode } from '../model'
import { $activeTabbedScreen, $tabbedScreenTrees } from '../screens'
import { $dropHint, $hiddenTreePanes, $layoutTree, $paneVisible, isMainStripPane, setActiveTabbedScreen } from '../store'

import { scrollGridWindowRect } from './grid'
import {
  $activeScrollWorkspaceId,
  $layoutSurfaceMode,
  $scrollWindowWorkspaces,
  requestScrollWindowIntoView,
  SCROLL_WINDOW_WORKSPACE_IDS,
  setActiveScrollWorkspace
} from './store'
import { scrollWindowColorBackground, useScrollWindowColor } from './window-color'

const GAP = 12
const MAP_WIDTH = 160
const MAP_HEIGHT = 22

function treeWindowIds(tree: LayoutNode | null): string[] {
  return tree ? allPaneIds(tree).filter(isMainStripPane) : []
}

interface MinimapWindowProps extends ComponentProps<'button'> {
  windowId: string
  iconSize: number
}

function MinimapWindow({ windowId, iconSize, style, ...props }: MinimapWindowProps) {
  const color = useScrollWindowColor(windowId)

  const icon = windowId.startsWith('terminal-instance:')
    ? 'terminal'
    : windowId === 'workspace' || windowId.startsWith('session-tile:')
      ? 'comment'
      : null

  return (
    <button
      {...props}
      data-scroll-minimap-window={windowId}
      style={{ ...style, ...(color ? { backgroundColor: scrollWindowColorBackground(color) } : {}) }}
    >
      {icon && iconSize >= 6 ? <Codicon name={icon} size={iconSize} /> : null}
    </button>
  )
}

export function ScrollWindowsMinimap() {
  const mode = useStore($layoutSurfaceMode)
  const tree = useStore($layoutTree)
  const hiddenTreePanes = useStore($hiddenTreePanes)
  const activeWorkspaceId = useStore($activeScrollWorkspaceId)
  const workspaces = useStore($scrollWindowWorkspaces)
  const workspaceEmpty = useStore($workspaceEmptyPlaceholder)
  const panes = useContributions('panes')

  if (mode !== 'scroll-windows') {
    return null
  }

  const workspace = workspaces.find(item => item.id === activeWorkspaceId) ?? workspaces[0]
  const layout = workspace.grid
  const paneIds = new Set(panes.map(pane => pane.id))

  const visibleWindowIds = treeWindowIds(tree).filter(
    id => paneIds.has(id) && !hiddenTreePanes.has(id) && !(id === 'workspace' && workspaceEmpty)
  )

  const windowIds = workspace.windowIds.filter(id => visibleWindowIds.includes(id))

  if (!layout || windowIds.length === 0) {
    return null
  }

  // Include the viewport's outer padding and any unused space after short strips.
  // Every rectangle uses the same scroll-content origin and scale as the real DOM.
  const viewportWidth = layout.viewportWidth + GAP * 2
  const viewportHeight = layout.viewportHeight + GAP * 2
  const scaleX = MAP_WIDTH / Math.max(viewportWidth, layout.canvasWidth + GAP * 2)
  const scaleY = MAP_HEIGHT / Math.max(viewportHeight, layout.canvasHeight + GAP * 2)
  const viewportLeft = Math.max(0, Math.min(MAP_WIDTH - viewportWidth * scaleX, workspace.scrollLeft * scaleX))
  const viewportTop = Math.max(0, Math.min(MAP_HEIGHT - viewportHeight * scaleY, workspace.scrollTop * scaleY))

  return (
    <div
      aria-label={`Workspace ${workspace.id} overview`}
      className="relative overflow-hidden"
      data-scroll-minimap=""
      style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
    >
      {windowIds.map((windowId, index) => {
        const rect = scrollGridWindowRect(layout, index, GAP)

        return (
          <MinimapWindow
            aria-label={`Scroll to window ${index + 1}`}
            className="absolute flex items-center justify-center overflow-hidden rounded-sm bg-(--ui-text-tertiary)/35 text-(--ui-text-primary) transition-[filter] hover:brightness-125"
            iconSize={Math.min(10, rect.width * scaleX - 2, rect.height * scaleY - 2)}
            key={windowId}
            onClick={() => requestScrollWindowIntoView(windowId)}
            style={{
              height: rect.height * scaleY,
              left: (rect.left + GAP) * scaleX,
              top: (rect.top + GAP) * scaleY,
              width: rect.width * scaleX
            }}
            type="button"
            windowId={windowId}
          />
        )
      })}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-sm border border-(--ui-accent)"
        style={{
          height: viewportHeight * scaleY,
          left: viewportLeft,
          top: viewportTop,
          width: viewportWidth * scaleX
        }}
      />
    </div>
  )
}

export function tabbedScreenPaneCount(
  tree: LayoutNode,
  workspaceEmptyPlaceholder: boolean,
  shownPaneIds: ReadonlySet<string>
): number {
  return allPaneIds(tree).filter(pane => {
    if (pane === 'sessions' || pane === 'files') {
      return false
    }

    // A parked workspace placeholder is the inert "No tabs open" host, not a
    // real user tab. Without this the screen chip kept an attention dot after
    // Close all even though the active surface was empty.
    if (pane === 'workspace' && workspaceEmptyPlaceholder) {
      return false
    }

    return shownPaneIds.has(pane)
  }).length
}

export function ScrollWindowsWorkspaceChips() {
  const panes = useContributions('panes')
  const hidden = useStore($hiddenTreePanes)
  const mode = useStore($layoutSurfaceMode)
  const fileBrowserOpen = useStore($fileBrowserOpen)
  const filesVisible = useStore($paneVisible('files'))
  const scrollWorkspaceId = useStore($activeScrollWorkspaceId)
  const tabbedScreenId = useStore($activeTabbedScreen)
  const tabbedTrees = useStore($tabbedScreenTrees)
  const workspaceEmptyPlaceholder = useStore($workspaceEmptyPlaceholder)
  const dropHint = useStore($dropHint)
  const workspaces = useStore($scrollWindowWorkspaces)
  const activeWorkspaceId = mode === 'tabbed' ? tabbedScreenId : scrollWorkspaceId
  const fileToggleActive = mode === 'scroll-windows' ? fileBrowserOpen : filesVisible
  const shownPaneIds = new Set(panes.filter(pane => !hidden.has(pane.id)).map(pane => pane.id))

  const counts = new Map(
    mode === 'tabbed'
      ? Object.entries(tabbedTrees).map(([id, tree]) => [id, tabbedScreenPaneCount(tree, workspaceEmptyPlaceholder, shownPaneIds)] as const)
      : workspaces.map(workspace => [workspace.id, workspace.windowIds.length] as const)
  )

  return (
    <div className="flex items-center">
      {SCROLL_WINDOW_WORKSPACE_IDS.map(id => {
        const active = id === activeWorkspaceId
        const draggingOver = mode === 'tabbed' && dropHint?.kind === 'screen' && dropHint.screenId === id
        const count = counts.get(id) ?? 0

        return (
          <Button
            aria-label={`Switch to workspace ${id}`}
            aria-pressed={active}
            className={cn(
              'relative text-[0.62rem] font-semibold',
              active || draggingOver
                ? 'bg-(--ui-control-active-background) text-(--ui-text-primary)'
                : 'text-muted-foreground/85 hover:bg-(--ui-control-hover-background) hover:text-foreground'
            )}
            data-tabbed-screen-target={mode === 'tabbed' ? id : undefined}
            key={id}
            onClick={() => (mode === 'tabbed' ? setActiveTabbedScreen(id) : setActiveScrollWorkspace(id))}
            size="icon-titlebar"

            type="button"
            variant="ghost"
          >
            {id}
            {count > 0 ? <span className="absolute bottom-1 size-1 rounded-full bg-(--ui-accent)" /> : null}
          </Button>
        )
      })}
      <Button
        aria-label={fileToggleActive ? 'Hide files' : 'Show files'}
        aria-pressed={fileToggleActive}
        className={cn(
          'text-muted-foreground/85 hover:bg-(--ui-control-hover-background) hover:text-foreground',
          fileToggleActive && 'bg-(--ui-control-active-background) text-(--ui-text-primary)'
        )}
        onClick={() => (mode === 'scroll-windows' ? setFileBrowserOpen(!fileBrowserOpen) : toggleFileBrowserOpen())}
        size="icon-titlebar"
        type="button"
        variant="ghost"
      >
        <Codicon name="layout-sidebar-right" size="13.9px" />
      </Button>
    </div>
  )
}
