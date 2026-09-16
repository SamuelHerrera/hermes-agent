import { useStore } from '@nanostores/react'
import { useRef } from 'react'

import type { DragKind } from '@/app/chat/hooks/use-file-drop-zone'
import { $sessionTileDragging, $sessionTileEdgeHover } from '@/components/pane-shell/tree/store'
import { DROP_SHEET_BLUR_CLASS, DROP_SHEET_CLASS } from '@/components/ui/drop-affordance'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Full-bleed affordance for files over the chat, or sessions over the text input.
 * Always `pointer-events-none` so the drop lands on the real element
 * underneath and the drop-zone handler claims it — the overlay is purely visual.
 * The label names the outcome (attach files / link this chat); the last kind is
 * held through the fade-out so it doesn't blank.
 */
export function ChatDropOverlay({ kind }: { kind: DragKind }) {
  const { t } = useI18n()
  const lastKind = useRef<DragKind>(kind)

  if (kind) {
    lastKind.current = kind
  }

  const shown = kind ?? lastKind.current

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 z-40 flex items-center justify-center transition-opacity duration-150 ease-out',
        kind ? 'opacity-100' : 'opacity-0'
      )}
      data-slot="chat-drop-overlay"
    >
      <div
        className={cn(
          DROP_SHEET_CLASS,
          DROP_SHEET_BLUR_CLASS,
          'absolute border-[color-mix(in_srgb,var(--dt-composer-ring)_55%,transparent)]',
          shown === 'session' ? 'inset-0 bg-(--dt-card)' : 'inset-2 bg-[color-mix(in_srgb,var(--dt-card)_55%,transparent)]'
        )}
      />
      {shown && (
        <span className="relative text-[11px] font-medium uppercase tracking-wide text-foreground">
          {shown === 'session' ? t.composer.dropSession : t.composer.dropFiles}
        </span>
      )}
    </div>
  )
}

/** Keep drag subscriptions on the affordance, not the whole chat/composer. */
export function SessionReferenceDropOverlay() {
  const dragging = useStore($sessionTileDragging)
  const edgeHover = useStore($sessionTileEdgeHover)

  return <ChatDropOverlay kind={dragging && !edgeHover ? 'session' : null} />
}
