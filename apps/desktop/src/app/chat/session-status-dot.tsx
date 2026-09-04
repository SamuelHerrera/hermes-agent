import { useStore } from '@nanostores/react'

import { Codicon } from '@/components/ui/codicon'
import { StatusPulse } from '@/components/ui/status-pulse'
import { Tip } from '@/components/ui/tooltip'
import { type Translations, useI18n } from '@/i18n'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $sessionColorById, sessionColorFor } from '@/store/session-color'
import { $sessionDotStateById, type SessionDotState } from '@/store/session-dot-state'
import type { SessionInfo } from '@/types/hermes'

// A pure lookup table: each state maps to its className, aria-label, and title.
// No priority resolution here — $sessionDotStateById already picked one.
// Label/title resolve from sidebar.row translations, keyed by name.
type DotVariant = {
  ariaLabel?: (r: Translations['sidebar']['row']) => string
  className: string
  icon?: 'loading'
  role?: 'status'
  title?: (r: Translations['sidebar']['row']) => string
}

type StatusIconVariant = {
  className: string
  icon: string
  label: (r: Translations['sidebar']['row']) => string
  spinning?: boolean
}

// Shared base for every active dot; idle is smaller and uses its own class.
const DOT_BASE = 'size-1.5 rounded-full'
const LOADING_RING_CLASS = 'size-3'

// Most states are dots: color + fill/hollow tell states apart. A live turn is
// the exception — it gets one shared finite pulse every five seconds, then
// returns to a normal dot as soon as the session settles.
const DOT_VARIANTS: Record<SessionDotState, DotVariant> = {
  // Amber — a clarify/approval is blocking the turn. The one "act now" color,
  // and the only state the user is required to do something about.
  'needs-input': {
    ariaLabel: r => r.needsInput,
    className: `${DOT_BASE} bg-amber-500`,
    role: 'status',
    title: r => r.waitingForAnswer
  },
  // Accent ring — the turn is running. Its finite shared pulse is the only
  // moving session treatment; settled states return to a normal dot.
  working: {
    ariaLabel: r => r.sessionRunning,
    className: `${LOADING_RING_CLASS} text-(--ui-accent)`,
    icon: 'loading',
    role: 'status'
  },
  // Muted accent ring — still authoritatively running, but nothing has
  // arrived for the watchdog window. Motion stays because the turn is alive;
  // opacity is what says it has gone quiet.
  stalled: {
    ariaLabel: r => r.sessionRunning,
    className: `${LOADING_RING_CLASS} text-(--ui-accent) opacity-70`,
    icon: 'loading',
    role: 'status',
    title: r => r.sessionRunning
  },
  // Hollow muted — a terminal(background=true) process outlived the turn. An
  // outline reads as "still open" without claiming the model is working; a
  // filled grey dot read as finished, the opposite of what this means.
  background: {
    ariaLabel: r => r.backgroundRunning,
    className: `${DOT_BASE} border border-(--ui-text-tertiary)`,
    role: 'status',
    title: r => r.backgroundRunning
  },
  // Emerald — the turn finished while the user was looking elsewhere.
  unread: {
    ariaLabel: r => r.finishedUnread,
    className: `${DOT_BASE} bg-emerald-500`,
    role: 'status',
    title: r => r.finishedUnread
  },
  // Hollow grey, the faintest ink the app has — nothing has ever run here. It
  // shares the outline with `background` because both mean "open, not
  // producing", and sits a shade dimmer because a draft is the one state that
  // has yet to do anything at all.
  draft: {
    ariaLabel: r => r.draftSession,
    className: `${DOT_BASE} border border-(--ui-text-quaternary)`,
    title: r => r.draftSession
  },
  // Settled: the project color when there is one, else the faintest filled
  // grey. Every session shows SOME mark — a row with nothing in the lead slot
  // reads as broken next to its neighbours, so "no color" falls back to the
  // quietest ink rather than to an invisible dot.
  idle: {
    className: 'size-1 rounded-full bg-(--ui-text-quaternary)'
  }
}

// Sidebar rows keep project identity on the left. Most transient state moves to
// a compact icon on the right, where its tooltip can explain the distinction
// without replacing the user's chosen project/session color. Live turns are the
// exception: the loading ring wraps the project dot itself so the moving cue and
// the color identity read as one marker.
const STATUS_ICON_VARIANTS: Record<Exclude<SessionDotState, 'idle'>, StatusIconVariant> = {
  'needs-input': {
    className: 'text-amber-500',
    icon: 'question',
    label: r => r.waitingForAnswer
  },
  working: {
    className: 'text-(--ui-accent)',
    icon: 'loading',
    label: r => r.sessionRunning,
    spinning: true
  },
  stalled: {
    className: 'text-(--ui-accent) opacity-70',
    icon: 'loading',
    label: r => r.sessionRunning,
    spinning: true
  },
  background: {
    className: 'text-(--ui-text-tertiary)',
    icon: 'terminal',
    label: r => r.backgroundRunning
  },
  unread: {
    className: 'text-emerald-500',
    icon: 'check',
    label: r => r.finishedUnread
  },
  draft: {
    className: 'text-(--ui-text-quaternary)',
    icon: 'edit',
    label: r => r.draftSession
  }
}

/** The dot a state paints, for surfaces that describe a status rather than
 *  render a session — the sidebar's status filter, say. Idle carries no color
 *  of its own (it inherits the project's), so callers supply one. */
export const sessionDotClassName = (state: SessionDotState): string =>
  DOT_VARIANTS[state].icon === 'loading' ? `${DOT_BASE} bg-(--ui-accent)` : DOT_VARIANTS[state].className

const isLoadingDotState = (state: SessionDotState): state is 'working' | 'stalled' =>
  state === 'working' || state === 'stalled'

function ProjectColorDot({ color }: { color: null | string }) {
  return (
    <span
      aria-hidden="true"
      className={DOT_VARIANTS.idle.className}
      style={color ? { backgroundColor: color } : undefined}
    />
  )
}

function LoadingProjectDot({
  color,
  r,
  state
}: {
  color: null | string
  r: Translations['sidebar']['row']
  state: 'working' | 'stalled'
}) {
  const variant = DOT_VARIANTS[state]
  const label = variant.ariaLabel?.(r)

  return (
    <span
      aria-label={label}
      className={cn('relative grid place-items-center', variant.className)}
      data-session-status={state}
      role={variant.role}
      title={variant.title?.(r) ?? label}
    >
      <StatusPulse
        aria-hidden="true"
        className="absolute inset-0 rounded-full border border-current"
        data-session-live-pulse
        kind="opacity"
      />
      <ProjectColorDot color={color} />
    </span>
  )
}

export interface SessionStatusDotProps {
  /** The STORED session id — the key every live-state atom (working /
   *  attention / stalled / unread / background) is keyed by. Pane tabs and the
   *  switcher pass the same stored id (`$workingSessionIds` et al. map
   *  `storedSessionId`). Sidebar rows split identity and status between
   *  SessionProjectDot and SessionStatusIcon instead.
   *
   *  Null on a new chat that has yet to reach the backend — no id to key by,
   *  and no turn behind it, which is the draft state by definition. */
  storedSessionId: null | string
  /** The session row for color resolution — recents OR the project tree. Both
   *  call sites already hold it; passing it lets the idle dot inherit the
   *  project color even for a session older than the paginated recents page
   *  (which has no `$sessionColorById` entry). */
  session?: null | SessionInfo
  /** TUI-style tree stem for a branched session (`└─ ` / `├─ `). */
  branchStem?: string
  /** Applied to the OUTER wrapper (stem + dot) — e.g. hover-fade on the
   *  reorder handle. */
  className?: string
}

export type SessionProjectDotProps = Pick<
  SessionStatusDotProps,
  'branchStem' | 'className' | 'session' | 'storedSessionId'
>

/** Project/session identity, with live-turn motion wrapped around the color dot. */
export function SessionProjectDot({ session, storedSessionId, branchStem, className }: SessionProjectDotProps) {
  const { t } = useI18n()
  const r = t.sidebar.row

  useStore($sessionColorById)

  const color = sessionColorFor(session) ?? null

  const dotState = useStoreSelector($sessionDotStateById, states =>
    storedSessionId ? (states[storedSessionId] ?? 'idle') : 'idle'
  )

  return (
    <span className={cn('flex items-center gap-0.5', className)} data-session-project-dot>
      {branchStem ? (
        <span aria-hidden className="shrink-0 font-mono text-[0.625rem] leading-none text-(--ui-text-quaternary)">
          {branchStem}
        </span>
      ) : null}
      {isLoadingDotState(dotState) ? (
        <LoadingProjectDot color={color} r={r} state={dotState} />
      ) : (
        <ProjectColorDot color={color} />
      )}
    </span>
  )
}

export interface SessionStatusIconProps {
  className?: string
  storedSessionId: null | string
}

/** Tooltip-backed transient status for the sidebar row's trailing slot. */
export function SessionStatusIcon({ className, storedSessionId }: SessionStatusIconProps) {
  const { t } = useI18n()
  const r = t.sidebar.row

  const dotState = useStoreSelector($sessionDotStateById, states =>
    storedSessionId ? (states[storedSessionId] ?? 'idle') : 'draft'
  )

  if (dotState === 'idle') {
    return null
  }

  if (isLoadingDotState(dotState)) {
    return null
  }

  const variant = STATUS_ICON_VARIANTS[dotState]
  const label = variant.label(r)

  return (
    <Tip label={label}>
      <span
        aria-label={label}
        className={cn('grid size-4 shrink-0 place-items-center', variant.className, className)}
        data-session-status={dotState}
        role="status"
        tabIndex={0}
      >
        <Codicon name={variant.icon} size="0.7rem" spinning={variant.spinning} />
      </span>
    </Tip>
  )
}

export interface SessionAttentionDotProps {
  className?: string
  storedSessionId: null | string
}

/** Compact transient status for pane tabs. Idle/draft stay out of the trailing
 *  slot so the left identity dot remains the stable project/session color. */
export function SessionAttentionDot({ className, storedSessionId }: SessionAttentionDotProps) {
  const { t } = useI18n()
  const r = t.sidebar.row

  const dotState = useStoreSelector($sessionDotStateById, states =>
    storedSessionId ? (states[storedSessionId] ?? 'idle') : 'draft'
  )

  if (dotState === 'idle' || dotState === 'draft' || isLoadingDotState(dotState)) {
    return null
  }

  const variant = STATUS_ICON_VARIANTS[dotState]
  const label = variant.label(r)

  return (
    <span
      aria-label={label}
      className={cn('grid size-4 shrink-0 place-items-center', variant.className, className)}
      data-session-attention-dot
      data-session-status={dotState}
      role="status"
      title={label}
    >
      <Codicon className="block leading-none" name={variant.icon} size="0.625rem" spinning={variant.spinning} />
    </span>
  )
}

/**
 * SESSION STATUS DOT — the compact combined treatment used by the session
 * the session switcher. It resolves everything itself from the stored session id:
 * the live state (via `$sessionDotStateById`, already reduced to one mutually
 * exclusive answer) and the color (override → project, via `sessionColorFor`).
 * An idle session shows its project color; a live turn wraps that color with a
 * loading ring; other active states own the dot with their semantic color so an
 * attention cue is never masked by the tint.
 */
export function SessionStatusDot({ storedSessionId, session, branchStem, className }: SessionStatusDotProps) {
  const { t } = useI18n()
  const r = t.sidebar.row

  // Subscribe to the shared color map for reactivity; sessionColorFor falls
  // back to the resolver for a session outside the recents page.
  useStore($sessionColorById)
  const color = sessionColorFor(session) ?? null

  // Selector, not a plain useStore: the map is rebuilt whenever any session's
  // status changes, but a given dot only repaints when ITS OWN state flips.
  const dotState = useStoreSelector($sessionDotStateById, states =>
    storedSessionId ? (states[storedSessionId] ?? 'idle') : 'draft'
  )

  const variant = DOT_VARIANTS[dotState]

  return (
    <span className={cn('flex items-center gap-0.5', className)}>
      {branchStem ? (
        <span aria-hidden className="shrink-0 font-mono text-[0.625rem] leading-none text-(--ui-text-quaternary)">
          {branchStem}
        </span>
      ) : null}
      {dotState === 'idle' ? (
        // Rendered even with no color to paint: an empty dot of the same size
        // keeps every row's title on one left edge, so a session finishing
        // can't shift the list under the pointer.
        <ProjectColorDot color={color} />
      ) : isLoadingDotState(dotState) ? (
        <LoadingProjectDot color={color} r={r} state={dotState} />
      ) : (
        <span
          aria-label={variant.ariaLabel?.(r)}
          className={variant.className}
          role={variant.role}
          title={variant.title?.(r)}
        />
      )}
    </span>
  )
}
