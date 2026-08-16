/** Shared kanban UI atoms: formatters, the identity avatar, the status menu,
 *  section chrome, and the masked scroller. Pure SDK + tokens. */

import {
  atom,
  coarseElapsed,
  Codicon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FadeScroll,
  GlyphSpinner,
  profileColor,
  profileColorSoft,
  relativeTime,
  useQuery
} from '@hermes/plugin-sdk'
import { type ReactNode, useEffect, useState } from 'react'

import { fetchOrchestration, ORCHESTRATION_KEY } from './api'
import { columnLabel, useKanban } from './i18n'
import { COLUMN_META, columnMeta, type KanbanColumn, type KanbanTag, type KanbanTask } from './types'

// Plugin-scoped i18n lives in ./i18n; re-exported so components import strings
// and chrome from one place (./ui).
export { columnHelp, columnLabel, type KanbanText, lockedReason, useKanban } from './i18n'

/** One-shot "open the new-task dialog in this lane" request, so a command that
 *  fires from ANYWHERE (keybind, palette) can reach the board page without the
 *  page having to exist yet: the handler navigates and drops the lane here, the
 *  page consumes it on arrival and clears it. Ephemeral by design — never
 *  persisted, so a remount can't reopen a dialog the user already dismissed. */
export const $newTaskLane = atom<null | string>(null)

/** Orchestration knobs (cached app-wide; the settings panel invalidates). */
export function useOrchestration() {
  return useQuery({ queryKey: ORCHESTRATION_KEY, queryFn: fetchOrchestration, staleTime: 60_000 }).data
}

/** The dispatcher's configured fallback for unassigned ready cards
 *  (`kanban.default_assignee`) — '' when unset, i.e. unassigned never runs. */
export function useDefaultAssignee(): string {
  const orchestration = useOrchestration()

  return (orchestration?.dispatch_default_assignee ?? orchestration?.default_assignee ?? '').trim()
}

// System-owned drop targets — you can drag a card OUT of these, never INTO
// them, so lanes/menus must not offer them as targets. `running`/`review` are
// claimed by the dispatcher; `scheduled` needs a wake-up time only an agent or
// the CLI can attach (a bare status drag is refused with a 409). The reason
// copy lives in the plugin i18n bundle (`locked.*`); see `lockedReason`.
export const LOCKED_COLUMNS = ['review', 'running', 'scheduled'] as const

export const isLockedTarget = (name: string): boolean => (LOCKED_COLUMNS as readonly string[]).includes(name)

export const shortId = (id?: null | string) => (id ?? '').replace(/^t_/, '').slice(0, 6)

const AI_TAG_NORMALIZED_PREFIX = 'ai:'

export function isAiManagedTag(tag: Pick<KanbanTag, 'name' | 'normalized_name'>): boolean {
  return (
    tag.normalized_name.toLowerCase().startsWith(AI_TAG_NORMALIZED_PREFIX) || tag.name.toLowerCase().startsWith('ai:')
  )
}

export function kanbanTagDisplayName(tag: Pick<KanbanTag, 'name' | 'normalized_name'>): string {
  if (!isAiManagedTag(tag)) {
    return tag.name
  }

  const withoutAiPrefix = tag.name.replace(/^ai:\s*/i, '').trim()

  return withoutAiPrefix || tag.name
}

// The electron REST bridge throws `Error("409: {\"detail\":\"…\"}")`; pull out
// the human-readable detail for a toast.
export function errText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const brace = raw.indexOf('{')

  if (brace !== -1) {
    try {
      return (JSON.parse(raw.slice(brace)) as { detail?: string }).detail ?? raw
    } catch {
      // Not JSON — fall through to the raw message.
    }
  }

  return raw
}

/** Backend timestamps are epoch SECONDS; the canonical formatter takes ms. */
export const ago = (seconds?: null | number, nowMs = Date.now()): null | string =>
  seconds ? relativeTime(seconds * 1000, nowMs) : null

export type KanbanLaneCount = {
  count: number
  label: string
  name: string
  tone: string
}

export const formatKanbanLaneCount = (count: number) => (count > 99 ? '99+' : String(count))

export function pluralKanbanTask(count: number) {
  return `task${count === 1 ? '' : 's'}`
}

const columnOrder = Object.keys(COLUMN_META)

function byColumnOrder(a: string, b: string) {
  const ai = columnOrder.indexOf(a)
  const bi = columnOrder.indexOf(b)

  if (ai === -1 && bi === -1) {
    return a.localeCompare(b)
  }
  if (ai === -1) {
    return 1
  }
  if (bi === -1) {
    return -1
  }

  return ai - bi
}

function laneCount(name: string, count: number, k: ReturnType<typeof useKanban>): KanbanLaneCount | null {
  if (count <= 0) {
    return null
  }

  return { count, label: columnLabel(k, name), name, tone: columnMeta(name).tone }
}

export function kanbanLaneCountsFromColumns(
  columns: readonly KanbanColumn[] | undefined,
  k: ReturnType<typeof useKanban>
): KanbanLaneCount[] {
  if (!columns) {
    return []
  }

  return [...columns]
    .sort((a, b) => byColumnOrder(a.name, b.name))
    .flatMap(col => {
      const count = col.tasks.length
      const item = laneCount(col.name, count, k)

      return item ? [item] : []
    })
}

export function kanbanLaneCountsFromStatusCounts(
  counts: null | Record<string, number> | undefined,
  k: ReturnType<typeof useKanban>,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): KanbanLaneCount[] {
  if (!counts) {
    return []
  }

  return Object.entries(counts)
    .filter(([name]) => includeArchived || name !== 'archived')
    .sort(([a], [b]) => byColumnOrder(a, b))
    .flatMap(([name, count]) => {
      const item = laneCount(name, count, k)

      return item ? [item] : []
    })
}

export function kanbanLaneCountsTip(prefix: string, counts: readonly KanbanLaneCount[]) {
  return `${prefix} — ${counts
    .map(({ count, label }) => `${count} ${label.toLowerCase()} ${pluralKanbanTask(count)}`)
    .join(', ')}`
}

export function KanbanLaneCounts({
  className,
  counts,
  labelPrefix = 'Kanban'
}: {
  className?: string
  counts: readonly KanbanLaneCount[]
  labelPrefix?: string
}) {
  if (counts.length === 0) {
    return null
  }

  return (
    <span
      className={['inline-flex items-center gap-1 text-(--ui-text-secondary)', className].filter(Boolean).join(' ')}
    >
      {counts.map(({ count, label, name, tone }) => {
        const aria = `${count} ${labelPrefix} ${label} ${pluralKanbanTask(count)}`

        if (name === 'running') {
          return (
            <span aria-label={aria} className="inline-flex items-center gap-1" key={name} title={aria}>
              <GlyphSpinner ariaLabel="Kanban tasks running" className="text-[0.6875rem] text-emerald-400" />
              <span className="text-[0.625rem] font-medium tabular-nums">{formatKanbanLaneCount(count)}</span>
            </span>
          )
        }

        return (
          <span aria-label={aria} className="inline-flex items-center gap-0.5" key={name} title={aria}>
            <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: tone }} />
            <span className="text-[0.625rem] font-medium tabular-nums">{formatKanbanLaneCount(count)}</span>
          </span>
        )
      })}
    </span>
  )
}

const ELAPSED_SUFFIX = { day: 'd', hour: 'h', minute: 'm', second: 's' } as const

/** Compact run duration ("42s", "3m") off the canonical elapsed bucketing. */
export function duration(start?: null | number, end?: null | number): null | string {
  if (!start || !end || end < start) {
    return null
  }

  const { unit, value } = coarseElapsed((end - start) * 1000)

  return `${value}${ELAPSED_SUFFIX[unit]}`
}

// ── liveness ─────────────────────────────────────────────────────────────────

/** Live elapsed label ("34s", "2m") that keeps ticking while mounted. */
function useTicking(start?: null | number): null | string {
  const [, force] = useState(0)

  useEffect(() => {
    if (!start) {
      return
    }

    const id = window.setInterval(() => force(n => n + 1), 5_000)

    return () => window.clearInterval(id)
  }, [start])

  if (!start) {
    return null
  }

  const { unit, value } = coarseElapsed(Math.max(0, Date.now() - start * 1000))

  return `${value}${ELAPSED_SUFFIX[unit]}`
}

export type ArcState = 'queued' | 'running' | 'stale'

export interface ActivitySettings {
  /** Explicit, valid kanban.default_assignee. Empty means unassigned ready/todo
   *  cards are intentionally parked and must not look active. */
  fallbackAssignee?: string
  /** Gateway auto-decomposer gate; unassigned triage is active only while on. */
  autoDecompose?: boolean
  /** Review dispatch gate; review cards may be human-only when off. */
  reviewDispatch?: boolean
}

/**
 * The card's machine-activity state. The board looked dead between "I made a
 * card" and "it's suddenly running" — this narrates the in-between. Only the
 * active states animate the border arc (see kanban.css): running = brisk sweep,
 * queued = quieter sweep, no-heartbeat = amber crawl. The queued set mirrors the
 * dispatcher/decomposer gates so parked unassigned cards stay visually idle.
 */
export function arcState(task: KanbanTask, settings: string | ActivitySettings): ArcState | null {
  const normalized = typeof settings === 'string' ? { fallbackAssignee: settings } : settings
  const fallbackAssignee = normalized.fallbackAssignee?.trim() ?? ''
  const autoDecompose = normalized.autoDecompose ?? true
  const reviewDispatch = normalized.reviewDispatch ?? true

  if (task.status === 'running') {
    const hasCurrentRun = task.current_run_id !== null && task.current_run_id !== undefined
    const legacyWithoutRunPointer = !Object.hasOwn(task, 'current_run_id')

    if (!hasCurrentRun && !legacyWithoutRunPointer) {
      return null
    }

    // No heartbeat for 2+ min = the worker may have died; the dispatcher will
    // reclaim it, but be honest instead of sweeping green forever.
    const stale = task.last_heartbeat_at ? Date.now() / 1000 - task.last_heartbeat_at > 120 : false

    return stale ? 'stale' : 'running'
  }

  const routed = Boolean(task.assignee || fallbackAssignee)

  const queued =
    (task.status === 'triage' && autoDecompose) ||
    (task.status === 'review' && reviewDispatch && Boolean(task.assignee)) ||
    (task.status === 'ready' && routed) ||
    (task.status === 'todo' && Boolean(task.parents_satisfied) && routed)

  return queued ? 'queued' : null
}

/** Ticking "working · 34s" line for running cards (elapsed since claim). */
export function RunClock({ task }: { task: KanbanTask }) {
  const k = useKanban()
  const elapsed = useTicking(task.started_at)

  if (!elapsed) {
    return null
  }

  return (
    <span className="shrink-0 font-medium" style={{ color: columnMeta('running').tone }}>
      {k.working} · {elapsed}
    </span>
  )
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s_\-./]+/)
    .filter(Boolean)

  return `${parts[0]?.[0] ?? '?'}${parts[1]?.[0] ?? ''}`.toUpperCase()
}

export function Avatar({ name, size = '1.25rem' }: { name: string; size?: string }) {
  // Same identity hue the rest of the app uses (profileColor); default/empty
  // profiles are neutral. Soft tag fill + colored glyph, per the app's tags.
  const color = profileColor(name)

  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        backgroundColor: color ? profileColorSoft(color, 22) : 'var(--ui-bg-quaternary)',
        color: color ?? 'var(--ui-text-secondary)',
        fontSize: '0.5625rem',
        height: size,
        width: size
      }}
      title={name}
    >
      {initials(name)}
    </span>
  )
}

// Jira-style status control: a colored button showing the current state, click
// to transition. Options carry their column dot; the active one is checked.
export function StatusMenu({
  columns,
  onMove,
  status
}: {
  columns: string[]
  onMove: (status: string) => void
  status: string
}) {
  const k = useKanban()
  const meta = columnMeta(status)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide transition-[filter] hover:brightness-105"
          style={{ backgroundColor: `color-mix(in srgb, ${meta.tone} 15%, transparent)`, color: meta.tone }}
          type="button"
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.tone }} />
          {columnLabel(k, status)}
          <Codicon name="chevron-down" size="0.7rem" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {columns
          .filter(name => name === status || !isLockedTarget(name))
          .map(name => (
            <DropdownMenuItem key={name} onSelect={() => onMove(name)}>
              <span className="size-2 rounded-full" style={{ backgroundColor: columnMeta(name).tone }} />
              {columnLabel(k, name)}
              {name === status && <Codicon className="ml-auto" name="check" size="0.8rem" />}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The board's one field/section-label style — hoisted so Section (here), the
// create dialog's Field, and the orchestration panel all read identically.
export const FIELD_LABEL = 'text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-(--ui-text-quaternary)'

export function Section({
  action,
  children,
  collapsible = false,
  defaultOpen = true,
  label
}: {
  action?: ReactNode
  children: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  label: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        {collapsible ? (
          <button
            className="-ml-1 inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-(--chrome-action-hover)"
            onClick={() => setOpen(value => !value)}
            type="button"
          >
            <Codicon
              className="shrink-0 text-(--ui-text-quaternary)"
              name={open ? 'chevron-down' : 'chevron-right'}
              size="0.75rem"
            />
            <span className={FIELD_LABEL}>{label}</span>
          </button>
        ) : (
          <div className={FIELD_LABEL}>{label}</div>
        )}
        {action}
      </div>
      {(!collapsible || open) && children}
    </section>
  )
}

// Tinted advisory panel: a `tone`-washed body with a matching left rule and a
// tone-colored icon+title header. Shared by the drawer's diagnostics and its
// ready-but-unassigned warning so both read identically.
export function Callout({
  children,
  icon = 'warning',
  title,
  tone
}: {
  children?: ReactNode
  icon?: string
  title: ReactNode
  tone: string
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-md p-2.5"
      style={{ backgroundColor: `color-mix(in srgb, ${tone} 7%, transparent)`, borderLeft: `2px solid ${tone}` }}
    >
      <div className="flex items-start gap-1.5 text-[0.75rem] font-medium" style={{ color: tone }}>
        <Codicon className="mt-px shrink-0" name={icon} size="0.8rem" />
        <span>{title}</span>
      </div>
      {children}
    </div>
  )
}

// A short, edge-masked scroll area. Thin wrapper over the app's FadeScroll so
// the drawer's scrollers behave exactly like the ones in chat; kept as a local
// name because every call site here passes `max`.
export function ScrollFade({
  children,
  className,
  deps,
  max = '9rem'
}: {
  children: ReactNode
  className?: string
  deps?: unknown
  max?: string
}) {
  return (
    <FadeScroll className={className} deps={deps} maxHeight={max}>
      {children}
    </FadeScroll>
  )
}
