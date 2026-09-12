import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { isElementInHiddenPane, PANE_HIDDEN_ATTR } from '@/components/pane-shell/pane-visibility'
import { consumeScrollWindowWheel, createScrollWheelAxisState } from '@/components/pane-shell/tree/scroll-windows/wheel'
import { $layoutTree } from '@/components/pane-shell/tree/store'
import { markRightPanePerf } from '@/debug/right-pane-events'
import { createRendererLoopPauseController } from '@/lib/renderer-loop-pause'
import { $paneStates } from '@/store/panes'

import { AgentTerminalInstance, TerminalInstance } from './instance'
import { selectTerminal, type TerminalEntry } from './terminals'
import { TerminalWorkspace } from './workspace'

/**
 * One xterm Terminal mounted at the layout root and CSS-overlayed onto
 * whichever `<TerminalSlot />` is active. Moving the host DOM detaches xterm's
 * WebGL renderer (it observes its own attachment) and resets the screen, so
 * the host stays put and we chase the slot's bounding rect with position:fixed.
 */

const $slots = atom<Record<string, HTMLElement>>({})

const SLOT_CLASS = 'relative flex min-h-0 min-w-0 flex-1 flex-col'

export function TerminalSlot({ terminalId, className = SLOT_CLASS }: { terminalId: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current

    if (!el) {
      return
    }

    $slots.set({ ...$slots.get(), [terminalId]: el })

    return () => {
      if ($slots.get()[terminalId] === el) {
        const next = { ...$slots.get() }
        delete next[terminalId]
        $slots.set(next)
      }
    }
  }, [terminalId])

  return <div className={className} data-terminal-slot={terminalId} ref={ref} />
}

interface PersistentTerminalProps {
  onAddSelectionToChat: (text: string, label?: string) => void
}

interface Rect {
  hidden: boolean
  top: number
  left: number
  width: number
  height: number
}

const sameRect = (a: Rect | null, b: Rect) =>
  !!a && a.hidden === b.hidden && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height

export function PersistentTerminal({ onAddSelectionToChat }: PersistentTerminalProps) {
  return <TerminalWorkspace onAddSelectionToChat={onAddSelectionToChat} />
}

export function PersistentTerminalHost({
  terminal,
  onAddSelectionToChat
}: PersistentTerminalProps & { terminal: TerminalEntry }) {
  const slots = useStore($slots)
  const slot = slots[terminal.id]
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const wheelAxisRef = useRef(createScrollWheelAxisState())
  const [rect, setRect] = useState<Rect | null>(null)

  // VS Code parity: once the pane has ever been opened, keep the terminals
  // mounted — and their shells alive — even while hidden. Hiding the pane just
  // collapses the slot, so the overlay below goes invisible; nothing is torn
  // down. Only an explicit per-tab close kills a PTY. Re-opening re-ensures one
  // terminal exists (covers having closed the last tab).
  const [mounted, setMounted] = useState(false)

  useLayoutEffect(() => {
    if (!slot) {
      setRect(previous => (previous ? { ...previous, hidden: true } : null))

      return
    }

    let prev: Rect | null = null
    let frame = 0
    let stopped = false
    let pendingReason = 'initial'
    let pauseController: ReturnType<typeof createRendererLoopPauseController> | null = null

    const rendererPaused = () => pauseController?.isPaused() ?? document.visibilityState === 'hidden'

    const applyRectStyle = (next: Rect) => {
      const overlay = overlayRef.current

      if (!overlay) {
        return
      }

      overlay.style.top = `${next.top}px`
      overlay.style.left = `${next.left}px`
      overlay.style.width = `${next.width}px`
      overlay.style.height = `${next.height}px`
      overlay.style.visibility = !next.hidden && next.width > 0 && next.height > 0 ? 'visible' : 'hidden'
      overlay.style.opacity = !next.hidden && next.width > 0 && next.height > 0 ? '1' : '0'
      overlay.style.pointerEvents = !next.hidden && next.width > 0 && next.height > 0 ? 'auto' : 'none'
    }

    const cancelFrame = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
    }

    const measure = (reason: string): boolean => {
      if (rendererPaused()) {
        return false
      }

      markRightPanePerf('terminal-measure', reason)
      const r = slot.getBoundingClientRect()
      // floor top/left + ceil right/bottom: overlay always covers the slot's
      // full pixel footprint, so half-pixel rects can't leak page bg through.
      const top = Math.floor(r.top)
      const left = Math.floor(r.left)

      // Inactive keep-alive panes deliberately retain the same rect as the
      // foreground pane, so visibility must be sampled independently.
      const next: Rect = {
        hidden: isElementInHiddenPane(slot),
        top,
        left,
        width: Math.ceil(r.right) - left,
        height: Math.ceil(r.bottom) - top
      }

      if (!sameRect(prev, next)) {
        prev = next
        applyRectStyle(next)
        setRect(next)

        if (next.width > 0 && next.height > 0) {
          if (!next.hidden) {
            setMounted(true)
          }
        }

        return true
      }

      return false
    }

    const scheduleMeasure = (reason = 'unknown') => {
      if (stopped || rendererPaused() || frame !== 0) {
        return
      }

      pendingReason = reason
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const reason = pendingReason

        if (measure(reason)) {
          scheduleMeasure('settle')
        }
      })
    }

    const handleVisibilityChange = () => {
      if (rendererPaused()) {
        cancelFrame()

        return
      }

      scheduleMeasure('visibility')
    }

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            scheduleMeasure('resize-observer')
          })

    const positionObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            scheduleMeasure('ancestor-mutation')
          })

    pauseController = createRendererLoopPauseController(handleVisibilityChange)

    if (measure('initial')) {
      scheduleMeasure('settle')
    }

    observer?.observe(slot)

    const handleScroll = (event: Event) => {
      if (event.currentTarget instanceof HTMLElement && event.currentTarget.hasAttribute('data-scroll-window-viewport')) {
        measure('scroll-window-scroll')

        return
      }

      scheduleMeasure('scroll')
    }
    const scrollTargets: Array<HTMLElement | Window> = [window]
    window.addEventListener('scroll', handleScroll)

    for (let node: HTMLElement | null = slot; node; node = node.parentElement) {
      positionObserver?.observe(node, {
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-state', PANE_HIDDEN_ATTR],
        attributes: true,
        childList: true,
        subtree: false
      })
      // Scroll does not bubble. Listen only on the slot's own ancestor chain,
      // so a transcript/file-tree/xterm viewport scroll elsewhere cannot wake
      // terminal positioning.
      node.addEventListener('scroll', handleScroll)
      scrollTargets.push(node)
    }

    // Nested layout-tree and pane-state commits can move the slot without
    // changing its own size. Subscribe to the actual layout authorities instead
    // of observing every descendant mutation under every ancestor (chat stream
    // and file-tree updates are unrelated and used to wake this tracker).
    const unsubscribeLayout = $layoutTree.listen(() => scheduleMeasure('layout-tree'))
    const unsubscribePanes = $paneStates.listen(() => scheduleMeasure('pane-state'))

    const handleResize = () => scheduleMeasure('window-resize')

    window.addEventListener('resize', handleResize)

    return () => {
      stopped = true
      cancelFrame()
      observer?.disconnect()
      positionObserver?.disconnect()
      unsubscribeLayout()
      unsubscribePanes()
      window.removeEventListener('resize', handleResize)
      scrollTargets.forEach(target => target.removeEventListener('scroll', handleScroll))
      pauseController?.dispose()
    }
  }, [slot])

  useEffect(() => {
    const overlay = overlayRef.current
    const viewport = slot?.closest<HTMLElement>('[data-scroll-window-viewport]') ?? null

    if (!overlay || !viewport) {
      return undefined
    }

    const onWheel = (event: WheelEvent) => {
      consumeScrollWindowWheel(event, viewport, wheelAxisRef.current)
    }

    overlay.addEventListener('wheel', onWheel, { capture: true, passive: false })

    return () => overlay.removeEventListener('wheel', onWheel, { capture: true })
  }, [slot])

  const visible = Boolean(rect && !rect.hidden && rect.width > 0 && rect.height > 0)

  const style: CSSProperties = {
    position: 'fixed',
    top: rect?.top ?? 0,
    left: rect?.left ?? 0,
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
    display: 'flex',
    flexDirection: 'column',
    visibility: visible ? 'visible' : 'hidden',
    // Electron may keep xterm's WebGL canvas visually composited after an
    // ancestor becomes visibility:hidden. Opacity clears that compositor layer
    // while preserving the mounted DOM, terminal dimensions, and live PTY.
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
    zIndex: 4,
    // Match the live skin surface so the header strip (transparent) and body
    // read as one cohesive pane instead of revealing a near-black slab behind.
    backgroundColor: 'var(--ui-terminal-surface-background)',
    contain: 'layout size paint'
  }

  // Defer the FIRST mount until the pane is open and the slot has real dims —
  // booting xterm/node-pty at 0×0 starts the shell at 80×24 and spawns a visible
  // conhost on Windows. After that `mounted` latches: shells persist while hidden.
  return (
    <div
      aria-hidden={!visible}
      data-persistent-terminal={terminal.id}
      onFocusCapture={() => selectTerminal(terminal.id)}
      onPointerDown={() => selectTerminal(terminal.id)}
      ref={overlayRef}
      style={style}
    >
      {mounted &&
        (terminal.kind === 'agent' ? (
          <AgentTerminalInstance active={visible} id={terminal.id} procId={terminal.procId!} />
        ) : (
          <TerminalInstance
            active={visible}
            cwd={terminal.cwd}
            id={terminal.id}
            onAddSelectionToChat={onAddSelectionToChat}
            profile={terminal.profile}
            restoreCwd={terminal.restoreCwd}
            reviveBuffer={terminal.reviveBuffer}
          />
        ))}
    </div>
  )
}
