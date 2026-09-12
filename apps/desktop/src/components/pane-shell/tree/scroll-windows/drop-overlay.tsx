import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import type { CSSProperties } from 'react'

import { DROP_SHEET_BLUR_CLASS, DROP_SHEET_CLASS } from '@/components/ui/drop-affordance'
import { cn } from '@/lib/utils'

import { radialPosition } from '../renderer/drag-session'

import type { ScrollDropEdge } from './columns'

interface DropTarget {
  windowId: string
  edge: ScrollDropEdge
}
const $target = atom<DropTarget | null>(null)

export function setScrollDropTarget(target: DropTarget | null) {
  const previous = $target.get()

  if (previous?.windowId !== target?.windowId || previous?.edge !== target?.edge) {
    $target.set(target)
  }
}

export function scrollDropEdge(rect: DOMRect, x: number, y: number): ScrollDropEdge {
  const position = radialPosition(rect, x, y)

  // Scroll cards don't have a tab stack: center drops reorder horizontally.
  return position === 'center' ? (x < rect.left + rect.width / 2 ? 'left' : 'right') : position
}

const REGION: Record<ScrollDropEdge | 'center', CSSProperties> = {
  bottom: { bottom: 6, left: 6, right: 6, top: '50%' },
  center: { bottom: 6, left: 6, right: 6, top: 6 },
  left: { bottom: 6, left: 6, right: '50%', top: 6 },
  right: { bottom: 6, left: '50%', right: 6, top: 6 },
  top: { bottom: '50%', left: 6, right: 6, top: 6 }
}

/** Keep hot hover updates off the expensive chat/composer tree. */
export function ScrollDropOverlay({ windowId }: { windowId: string }) {
  const target = useStore($target)
  const active = target?.windowId === windowId

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div
        className={cn(
          DROP_SHEET_CLASS,
          'absolute transition-[top,right,bottom,left,background-color,border-color,opacity] duration-150 ease-out',
          active && DROP_SHEET_BLUR_CLASS
        )}
        data-scroll-drop-preview={active ? target.edge : 'idle'}
        style={{
          ...REGION[active ? target.edge : 'center'],
          background: active
            ? 'color-mix(in srgb, var(--ui-accent) 18%, color-mix(in srgb, var(--dt-card) 55%, transparent))'
            : 'color-mix(in srgb, var(--ui-accent) 5%, color-mix(in srgb, var(--dt-card) 25%, transparent))',
          borderColor: `color-mix(in srgb, var(--ui-accent) ${active ? 75 : 28}%, transparent)`
        }}
      />
    </div>
  )
}
