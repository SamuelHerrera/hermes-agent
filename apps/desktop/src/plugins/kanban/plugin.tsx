/**
 * Kanban — the founding plugin use case, now pure SDK-consumer work: a
 * first-class `/kanban` board page + sidebar nav row + a live statusbar count,
 * all reusing the existing `plugins/kanban/dashboard/plugin_api.py` REST router
 * through `ctx.rest` (namespace-scoped to `/api/plugins/kanban`). No new
 * backend, no core edits.
 *
 * Ships OFF by default (`defaultEnabled: false`): it inventories in
 * Settings ▸ Plugins and registers nothing until the user flips the switch.
 */

import './kanban.css'

import {
  cn,
  Codicon,
  GlyphSpinner,
  type HermesPlugin,
  host,
  type KeybindContribution,
  KEYBINDS_AREA,
  PALETTE_AREA,
  type PaletteContribution,
  type RouteContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution,
  STATUSBAR_AREAS,
  Tip,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'

import { $boardSlug, bindApi, boardKey, fetchBoard } from './api'
import { KanbanBoardPage } from './board'
import { columnLabel, KANBAN_LOCALES } from './i18n'
import { columnMeta } from './types'
import { $newTaskLane, useKanban } from './ui'

type KanbanCounts = {
  active: number
  attention: number
  ready: number
  running: number
}

function boardCounts(board: Awaited<ReturnType<typeof fetchBoard>> | undefined): KanbanCounts {
  const count = (name: string) => board?.columns.find(col => col.name === name)?.tasks.length ?? 0

  const running = count('running')
  const ready = count('ready')
  const attention = count('blocked') + count('review')

  return { active: running + ready, attention, ready, running }
}

type KanbanNavColumnCount = {
  count: number
  label: string
  name: string
  tone: string
}

const formatNavCount = (count: number) => (count > 99 ? '99+' : String(count))

function pluralTask(count: number) {
  return `task${count === 1 ? '' : 's'}`
}

function boardNavCounts(
  board: Awaited<ReturnType<typeof fetchBoard>> | undefined,
  k: ReturnType<typeof useKanban>
): KanbanNavColumnCount[] {
  if (!board) {
    return []
  }

  return board.columns.flatMap(col => {
    const count = col.tasks.length

    if (count === 0) {
      return []
    }

    return [{ count, label: columnLabel(k, col.name), name: col.name, tone: columnMeta(col.name).tone }]
  })
}

function navCountsTip(counts: readonly KanbanNavColumnCount[]) {
  return `Kanban — ${counts.map(({ count, label }) => `${count} ${label.toLowerCase()} ${pluralTask(count)}`).join(', ')}`
}

// Live "N running / ready" pill — one glance at fleet activity from anywhere,
// clicks through to the board. Shares the board query (one cache, one poll with
// the page); hidden when nothing is in flight (or unloaded).
function KanbanCount() {
  const k = useKanban()
  const slug = useValue($boardSlug)

  // Socket-invalidated like the page (same cache); slow socketless heartbeat.
  const { data: board } = useQuery({
    queryFn: () => fetchBoard(false),
    queryKey: boardKey(slug, false),
    refetchInterval: 60_000
  })

  if (!board) {
    return null
  }

  const { active, ready, running } = boardCounts(board)

  if (active === 0) {
    return null
  }

  return (
    <Tip label={k.countTip(running, ready)}>
      <button
        className={cn(
          'inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] tabular-nums transition-colors',
          'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
        )}
        onClick={() => host.openRouteTile('/kanban')}
        type="button"
      >
        <Codicon name="project" size="0.7rem" />
        <span>{active}</span>
      </button>
    </Tip>
  )
}

export function KanbanNavStatus() {
  const k = useKanban()
  const slug = useValue($boardSlug)

  const { data: board } = useQuery({
    queryFn: () => fetchBoard(false),
    queryKey: boardKey(slug, false),
    refetchInterval: 60_000
  })

  const counts = boardNavCounts(board, k)

  if (counts.length === 0) {
    return null
  }

  return (
    <Tip label={navCountsTip(counts)}>
      <span className="inline-flex items-center gap-1 text-(--ui-text-secondary)">
        {counts.map(({ count, label, name, tone }) => {
          const aria = `${count} Kanban ${label} ${pluralTask(count)}`

          if (name === 'running') {
            return (
              <span aria-label={aria} className="inline-flex items-center gap-1" key={name} title={aria}>
                <GlyphSpinner ariaLabel="Kanban tasks running" className="text-[0.6875rem] text-emerald-400" />
                <span className="text-[0.625rem] font-medium tabular-nums">{formatNavCount(count)}</span>
              </span>
            )
          }

          return (
            <span aria-label={aria} className="inline-flex items-center gap-0.5" key={name} title={aria}>
              <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: tone }} />
              <span className="text-[0.625rem] font-medium tabular-nums">{formatNavCount(count)}</span>
            </span>
          )
        })}
      </span>
    </Tip>
  )
}

export function KanbanRouteTabLead() {
  const k = useKanban()
  const slug = useValue($boardSlug)

  const { data: board } = useQuery({
    queryFn: () => fetchBoard(false),
    queryKey: boardKey(slug, false),
    refetchInterval: 60_000
  })

  const { active, ready, running } = boardCounts(board)

  if (running === 0) {
    return null
  }

  return (
    <Tip label={k.countTip(running, ready)}>
      <span
        aria-label="Kanban tasks running"
        className="grid size-3 place-items-center text-(--ui-accent)"
        role="status"
        title={k.countTip(running, ready)}
      >
        <Codicon className="block leading-none" name="loading" size="0.625rem" spinning />
        <span className="sr-only">{active}</span>
      </span>
    </Tip>
  )
}

const plugin: HermesPlugin = {
  id: 'kanban',
  name: 'Kanban',
  description: 'Multi-agent task board — board page, sidebar entry, and a live in-flight count in the status bar.',
  defaultEnabled: false,
  register(ctx) {
    ctx.i18n.register(KANBAN_LOCALES)
    ctx.onDispose(bindApi(ctx.rest, ctx.storage, ctx.socket))

    // The plugin command pattern: ONE action id (`kanban.newTask`) wired into
    // two areas — a keybind (dispatch + rebindable panel row) and a palette row
    // whose `action` field points back at it, so ⌘K shows the live combo. The
    // handler is route-independent: it parks the request in `$newTaskLane`, then
    // opens the board as a route tile, so the hotkey works from anywhere without
    // replacing the main workspace page.
    //
    // ⌘⌥N / Ctrl+Alt+N: `mod+n` is `session.new` and `mod+shift+n` is
    // `session.newWindow`, both core built-ins a plugin can't shadow. Adding
    // Alt keeps the "N for new" mnemonic on a chord core leaves free — it uses
    // `alt` only for the `mod+alt+1…9` profile slots, never with a letter. That
    // makes ⌘⌥<letter> the natural namespace for plugin commands.
    const newTask = () => {
      $newTaskLane.set('triage')
      host.openRouteTile('/kanban')
    }

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/kanban', tabLead: () => <KanbanRouteTabLead /> } satisfies RouteContribution,
        render: () => <KanbanBoardPage />
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 50,
        data: {
          codicon: 'project',
          label: 'Kanban',
          openAsTile: true,
          path: '/kanban'
        } satisfies SidebarNavContribution,
        render: () => <KanbanNavStatus />
      },
      {
        id: 'count',
        area: STATUSBAR_AREAS.right,
        order: 80,
        render: () => <KanbanCount />
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'kanban.open',
          label: 'Kanban: Open board',
          keywords: ['kanban', 'board', 'tasks', 'agents'],
          run: () => host.openRouteTile('/kanban')
        } satisfies PaletteContribution
      },
      {
        id: 'new-task',
        area: PALETTE_AREA,
        data: {
          id: 'kanban.newTask',
          action: 'kanban.newTask',
          label: ctx.i18n.t('newTaskCommand'),
          keywords: ['kanban', 'task', 'new', 'create', 'triage'],
          run: newTask
        } satisfies PaletteContribution
      },
      {
        id: 'new-task',
        area: KEYBINDS_AREA,
        data: {
          id: 'kanban.newTask',
          category: 'view',
          defaults: ['mod+alt+n'],
          label: ctx.i18n.t('newTaskCommand'),
          run: newTask
        } satisfies KeybindContribution
      }
    ])
  }
}

export default plugin
