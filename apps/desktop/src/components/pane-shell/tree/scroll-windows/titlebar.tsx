import { useStore } from '@nanostores/react'
import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

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
  const activeWorkspaceId = useStore($activeScrollWorkspaceId)
  const workspaces = useStore($scrollWindowWorkspaces)

  if (mode !== 'scroll-windows') {
    return null
  }

  const workspace = workspaces.find(item => item.id === activeWorkspaceId) ?? workspaces[0]
  const layout = workspace.grid

  if (!layout || workspace.windowIds.length === 0) {
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
      {workspace.windowIds.map((windowId, index) => {
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

export function ScrollWindowsWorkspaceChips() {
  const mode = useStore($layoutSurfaceMode)
  const activeWorkspaceId = useStore($activeScrollWorkspaceId)
  const workspaces = useStore($scrollWindowWorkspaces)

  if (mode !== 'scroll-windows') {
    return null
  }

  const counts = new Map(workspaces.map(workspace => [workspace.id, workspace.windowIds.length]))

  return (
    <div className="flex items-center">
      {SCROLL_WINDOW_WORKSPACE_IDS.map(id => {
        const active = id === activeWorkspaceId
        const count = counts.get(id) ?? 0

        return (
          <Button
            aria-label={`Switch to workspace ${id}`}
            aria-pressed={active}
            className={cn(
              'relative text-[0.62rem] font-semibold',
              active
                ? 'bg-(--ui-control-active-background) text-(--ui-text-primary)'
                : 'text-muted-foreground/85 hover:bg-(--ui-control-hover-background) hover:text-foreground'
            )}
            key={id}
            onClick={() => setActiveScrollWorkspace(id)}
            size="icon-titlebar"
            title={count > 0 ? `${count} window${count === 1 ? '' : 's'}` : 'Empty workspace'}
            type="button"
            variant="ghost"
          >
            {id}
            {count > 0 ? <span className="absolute bottom-1 size-1 rounded-full bg-(--ui-accent)" /> : null}
          </Button>
        )
      })}
    </div>
  )
}
