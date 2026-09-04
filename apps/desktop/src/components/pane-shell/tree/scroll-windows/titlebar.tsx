import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
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

const GAP = 12

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
    return <div className="text-[0.68rem] font-medium text-(--ui-text-tertiary)">Workspace {workspace.id}</div>
  }

  const viewportWidth = Math.max(1, Math.min(layout.canvasWidth, layout.viewportWidth ?? layout.windowWidth))
  const viewportHeight = Math.max(1, Math.min(layout.canvasHeight, layout.viewportHeight ?? layout.canvasHeight))
  const scaleX = 120 / Math.max(1, layout.canvasWidth)
  const scaleY = 14 / Math.max(1, layout.canvasHeight)
  const viewportLeft = Math.min(120 - Math.max(7, viewportWidth * scaleX), workspace.scrollLeft * scaleX)
  const viewportTop = Math.min(14 - Math.max(5, viewportHeight * scaleY), workspace.scrollTop * scaleY)

  return (
    <div className="flex items-center gap-2 rounded-md bg-(--ui-sidebar-surface-background)/85 px-2 py-1 shadow-sm backdrop-blur">
      <span className="text-[0.62rem] font-semibold text-(--ui-text-tertiary)">W{workspace.id}</span>
      <div className="relative h-[14px] w-[120px] overflow-hidden rounded-md bg-(--ui-control-active-background)">
        {workspace.windowIds.map((windowId, index) => {
          const rect = scrollGridWindowRect(layout, index, GAP)

          return (
            <button
              aria-label={`Scroll to window ${index + 1}`}
              className="absolute rounded-sm bg-(--ui-text-tertiary)/35 transition-colors hover:bg-(--ui-text-secondary)"
              key={windowId}
              onClick={() => requestScrollWindowIntoView(windowId)}
              style={{
                height: Math.max(3, rect.height * scaleY),
                left: rect.left * scaleX,
                top: rect.top * scaleY,
                width: Math.max(7, rect.width * scaleX)
              }}
              type="button"
            />
          )
        })}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-sm border border-(--ui-accent) bg-(--ui-accent)/10"
          style={{
            height: Math.max(5, viewportHeight * scaleY),
            left: viewportLeft,
            top: viewportTop,
            width: Math.max(7, viewportWidth * scaleX)
          }}
        />
      </div>
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
