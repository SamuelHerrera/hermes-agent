import { useStore } from '@nanostores/react'
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { useContributions } from '@/contrib/react/use-contributions'
import { cn } from '@/lib/utils'
import {
  $sidebarOpen,
  $sidebarWidth,
  CHAT_SIDEBAR_PANE_ID,
  setSidebarResizing,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH
} from '@/store/layout'
import { setPaneWidthOverride } from '@/store/panes'

import { PaneGroupContext, PaneVisibleContext } from '../../pane-visibility'
import { allPaneIds, type LayoutNode } from '../model'
import { paneChrome } from '../renderer/track-model'
import { $layoutTree, closeTabPane, isSessionStripPane } from '../store'

import { generateScrollGrid, type ScrollGridLayout, scrollGridWindowRect } from './grid'
import {
  $activeScrollWorkspaceId,
  $scrollWindowWorkspaces,
  focusScrollWindowWindow,
  reorderScrollWindowWindow,
  SCROLL_WINDOW_SCROLL_EVENT,
  setScrollWorkspaceGrid,
  setScrollWorkspaceScroll,
  syncScrollWindowWindows
} from './store'

const GAP = 12
const MIN_WINDOW_WIDTH = 360
const MIN_WINDOW_HEIGHT = 280
const WINDOW_HEADER_HEIGHT = 30
const SCROLLBAR_CROSS_AXIS_GUTTER = 8
const SCROLL_WINDOW_DRAG_TYPE = 'application/x-hermes-scroll-window'

function treeWindowIds(tree: LayoutNode | null): string[] {
  return tree ? allPaneIds(tree).filter(isSessionStripPane) : []
}

export function ScrollWindowWorkspace() {
  const tree = useStore($layoutTree)
  const panes = useContributions('panes')
  const activeWorkspaceId = useStore($activeScrollWorkspaceId)
  const workspaces = useStore($scrollWindowWorkspaces)
  const sidebarOpen = useStore($sidebarOpen)
  const sidebarWidth = useStore($sidebarWidth)
  const viewportRef = useRef<HTMLDivElement>(null)
  const measuredWorkspaceIdRef = useRef<string | null>(null)
  const [layoutFrame, setLayoutFrame] = useState({ height: 720, width: 1280 })
  const [draggingWindowId, setDraggingWindowId] = useState<null | string>(null)

  const paneById = useMemo(() => new Map(panes.map(pane => [pane.id, pane])), [panes])
  const availableWindowIds = useMemo(() => treeWindowIds(tree).filter(id => paneById.has(id)), [paneById, tree])
  const availableWindowKey = availableWindowIds.join('\u0000')
  const sidebarPane = paneById.get('sessions')

  useEffect(() => {
    syncScrollWindowWindows(availableWindowIds)
  }, [availableWindowIds, availableWindowKey])

  const workspace = workspaces.find(item => item.id === activeWorkspaceId) ?? workspaces[0]
  const windowIds = workspace.windowIds.filter(id => availableWindowIds.includes(id))
  const windowIdsKey = windowIds.join('\u0000')

  const layout = useMemo<ScrollGridLayout>(
    () =>
      generateScrollGrid({
        gap: GAP,
        minWindowHeight: MIN_WINDOW_HEIGHT,
        minWindowWidth: MIN_WINDOW_WIDTH,
        viewportHeight: Math.max(1, layoutFrame.height - GAP * 2 - SCROLLBAR_CROSS_AXIS_GUTTER),
        viewportWidth: Math.max(1, layoutFrame.width - GAP * 2),
        rows: workspace.rowCount,
        windowCount: Math.max(1, windowIds.length)
      }),
    [layoutFrame.height, layoutFrame.width, windowIds.length, workspace.rowCount]
  )

  useLayoutEffect(() => {
    const element = viewportRef.current

    if (!element || windowIds.length === 0 || measuredWorkspaceIdRef.current === activeWorkspaceId) {
      return
    }

    measuredWorkspaceIdRef.current = activeWorkspaceId
    const rect = element.getBoundingClientRect()
    setLayoutFrame(current => {
      const next = { height: Math.max(1, rect.height), width: Math.max(1, rect.width) }

      return Math.abs(current.height - next.height) < 1 && Math.abs(current.width - next.width) < 1 ? current : next
    })
  }, [activeWorkspaceId, windowIds.length, windowIdsKey])

  useEffect(() => {
    setScrollWorkspaceGrid(workspace.id, windowIds.length > 0 ? layout : null)
  }, [layout, windowIds.length, workspace.id])

  useLayoutEffect(() => {
    const element = viewportRef.current

    if (!element) {
      return
    }

    element.scrollLeft = workspace.scrollLeft
    element.scrollTop = workspace.scrollTop
  }, [workspace.id, workspace.scrollLeft, workspace.scrollTop])

  useEffect(() => {
    const element = viewportRef.current

    if (!element) {
      return undefined
    }

    let frame = 0

    const onScroll = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() =>
        setScrollWorkspaceScroll(workspace.id, element.scrollLeft, element.scrollTop)
      )
    }

    element.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.cancelAnimationFrame(frame)
      element.removeEventListener('scroll', onScroll)
    }
  }, [workspace.id])

  useEffect(() => {
    const element = viewportRef.current

    if (!element) {
      return undefined
    }

    const onScrollToWindow = (event: Event) => {
      const windowId = (event as CustomEvent<{ windowId?: string }>).detail?.windowId
      const index = windowId ? windowIds.indexOf(windowId) : -1

      if (!windowId || index < 0) {
        return
      }

      const rect = scrollGridWindowRect(layout, index, GAP)
      focusScrollWindowWindow(windowId)
      element.scrollTo({ behavior: 'smooth', left: Math.max(0, rect.left - GAP), top: Math.max(0, rect.top - GAP) })
    }

    window.addEventListener(SCROLL_WINDOW_SCROLL_EVENT, onScrollToWindow)

    return () => window.removeEventListener(SCROLL_WINDOW_SCROLL_EVENT, onScrollToWindow)
  }, [layout, windowIds])

  useEffect(() => {
    const element = viewportRef.current

    if (!element) {
      return undefined
    }

    const onWheel = (event: WheelEvent) => {
      const horizontalDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0

      if (horizontalDelta === 0) {
        return
      }

      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth)

      if (maxScrollLeft === 0) {
        return
      }

      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft + horizontalDelta))

      if (nextScrollLeft === element.scrollLeft) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      element.scrollLeft = nextScrollLeft
    }

    element.addEventListener('wheel', onWheel, { capture: true, passive: false })

    return () => element.removeEventListener('wheel', onWheel, { capture: true })
  }, [])

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const restoreCursor = document.body.style.cursor
    const restoreSelect = document.body.style.userSelect

    handle.setPointerCapture?.(pointerId)
    setSidebarResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent) => {
      const width = Math.round(startWidth + moveEvent.clientX - startX)
      const clamped = Math.max(SIDEBAR_DEFAULT_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width))

      setPaneWidthOverride(CHAT_SIDEBAR_PANE_ID, clamped)
    }

    const finish = () => {
      handle.releasePointerCapture?.(pointerId)
      setSidebarResizing(false)
      document.body.style.cursor = restoreCursor
      document.body.style.userSelect = restoreSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 bg-(--ui-editor-surface-background)">
      <style>{`
        [data-scroll-window-pane] :is(aside, [data-slot=sidebar]) {
          border-left-width: 0;
          border-right-width: 0;
          box-shadow: none;
        }
        [data-scroll-window-pane] header[class*="h-(--titlebar-height)"] {
          display: none;
        }
      `}</style>
      {sidebarOpen && sidebarPane?.render ? (
        <aside
          className="relative z-10 flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background)"
          data-scroll-window-sidebar=""
          style={{ width: sidebarWidth }}
        >
          <PaneGroupContext.Provider value="scroll-sidebar">
            <PaneVisibleContext.Provider value>
              <ContribBoundary id={sidebarPane.id}>
                <ContribRender render={sidebarPane.render} />
              </ContribBoundary>
            </PaneVisibleContext.Provider>
          </PaneGroupContext.Provider>
          <div
            aria-label="Resize sidebar"
            className="absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize [-webkit-app-region:no-drag]"
            data-scroll-window-sidebar-resizer=""
            onPointerDown={startSidebarResize}
            role="separator"
          >
            <div className="mx-auto h-full w-px bg-(--ui-stroke-secondary) opacity-0 transition-opacity hover:opacity-100" />
          </div>
        </aside>
      ) : null}
      <div
        className="relative z-0 h-full min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-contain p-3 [scrollbar-gutter:stable]"
        data-scroll-window-viewport=""
        data-session-anchor="workspace"
        ref={viewportRef}
      >
        {windowIds.length === 0 ? (
          <div className="grid h-full place-items-center rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background)/75 text-center shadow-sm">
            <div className="space-y-2 px-6">
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.16em] text-(--ui-text-tertiary)">
                Workspace {workspace.id}
              </div>
              <div className="text-sm font-medium text-(--ui-text-secondary)">No chat windows here yet</div>
              <div className="max-w-sm text-xs text-(--ui-text-quaternary)">
                Open a new chat while this workspace is active to add it to this scroll-window desktop.
              </div>
            </div>
          </div>
        ) : (
          <div className="relative" style={{ height: layout.canvasHeight, width: layout.canvasWidth }}>
            {windowIds.map((windowId, index) => {
              const pane = paneById.get(windowId)
              const chrome = paneChrome(pane)
              const title = chrome.tabTitle?.() ?? pane?.title ?? windowId
              const rect = scrollGridWindowRect(layout, index, GAP)
              const focused = workspace.focusedWindowId === windowId || (!workspace.focusedWindowId && index === 0)

              const style: CSSProperties = {
                height: rect.height,
                left: rect.left,
                top: rect.top,
                width: rect.width
              }

              return (
                <section
                  aria-label={typeof title === 'string' ? title : `Window ${index + 1}`}
                  className={cn(
                    'absolute flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-(--ui-chat-surface-background) shadow-md transition-[border-color,box-shadow]',
                    draggingWindowId === windowId && 'opacity-70',
                    focused
                      ? 'border-(--ui-accent) shadow-[0_0_0_1px_color-mix(in_srgb,var(--ui-accent)_55%,transparent)]'
                      : 'border-(--ui-stroke-secondary)'
                  )}
                  data-scroll-window={windowId}
                  key={windowId}
                  onDragOver={event => {
                    if (!draggingWindowId || draggingWindowId === windowId) {
                      return
                    }

                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={event => {
                    const sourceWindowId =
                      event.dataTransfer.getData(SCROLL_WINDOW_DRAG_TYPE) || event.dataTransfer.getData('text/plain')

                    if (!sourceWindowId || sourceWindowId === windowId) {
                      return
                    }

                    const targetRect = event.currentTarget.getBoundingClientRect()
                    const createRow = event.clientY > targetRect.top + targetRect.height * 0.72

                    event.preventDefault()
                    event.stopPropagation()
                    reorderScrollWindowWindow(sourceWindowId, windowId, { createRow })
                    requestAnimationFrame(() => setDraggingWindowId(null))
                  }}
                  onPointerDown={() => focusScrollWindowWindow(windowId)}
                  style={style}
                >
                  <div
                    className="flex h-[30px] shrink-0 cursor-grab select-none items-center gap-2 border-b border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background)/95 px-2 text-xs active:cursor-grabbing"
                    data-scroll-window-header=""
                    draggable
                    onDragEnd={() => setDraggingWindowId(null)}
                    onDragStart={event => {
                      event.dataTransfer.setData(SCROLL_WINDOW_DRAG_TYPE, windowId)
                      event.dataTransfer.setData('text/plain', windowId)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setDragImage(
                        event.currentTarget,
                        event.nativeEvent.offsetX,
                        event.nativeEvent.offsetY
                      )
                      setDraggingWindowId(windowId)
                    }}
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-(--ui-control-active-background) text-[0.65rem] font-semibold text-(--ui-text-secondary)">
                      {index + 1}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-[0.72rem] font-medium text-(--ui-text-primary)"
                      data-scroll-window-title=""
                    >
                      {title}
                    </span>
                    {windowId !== 'workspace' ? (
                      <button
                        aria-label="Close window"
                        className="grid size-5 shrink-0 place-items-center rounded text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-primary)"
                        onClick={event => {
                          event.stopPropagation()
                          closeTabPane(windowId)
                        }}
                        type="button"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                  <div className="relative min-h-0 flex-1 overflow-hidden" data-scroll-window-pane="">
                    {pane?.render ? (
                      <PaneGroupContext.Provider value={`scroll-${workspace.id}-${windowId}`}>
                        <PaneVisibleContext.Provider value>
                          <ContribBoundary id={pane.id}>
                            <ContribRender render={pane.render} />
                          </ContribBoundary>
                        </PaneVisibleContext.Provider>
                      </PaneGroupContext.Provider>
                    ) : (
                      <div className="p-3 font-mono text-[11px] text-(--ui-text-quaternary)">
                        Missing pane {windowId}
                      </div>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
