import { atom, computed } from 'nanostores'

import { capitalize } from '@/lib/text'
import type { SessionInfo } from '@/types/hermes'

export type SubagentStatus = 'completed' | 'failed' | 'interrupted' | 'queued' | 'running'
export type SubagentStreamKind = 'progress' | 'summary' | 'thinking' | 'tool'

export interface SubagentStreamEntry {
  at: number
  isError?: boolean
  kind: SubagentStreamKind
  text: string
}

export interface SubagentProgress {
  id: string
  parentId: null | string
  /** Durable parent conversation id. The map key remains the live runtime id. */
  parentSessionId?: string
  goal: string
  /** The child's own stored session id — lets UIs open its session window. */
  sessionId?: string
  model?: string
  profile?: string
  status: SubagentStatus
  taskCount: number
  taskIndex: number
  startedAt: number
  updatedAt: number
  durationSeconds?: number
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  toolCount?: number
  filesRead: string[]
  filesWritten: string[]
  stream: SubagentStreamEntry[]
  summary?: string
  /** Active tool while running — cleared on terminal status. */
  currentTool?: string
}

export interface SubagentNode extends SubagentProgress {
  children: SubagentNode[]
}

export type SubagentPayload = Record<string, unknown>

const TERMINAL: ReadonlySet<SubagentStatus> = new Set(['completed', 'failed', 'interrupted'])
const MAX_STREAM = 24
const PREVIEW_MAX = 220
const TOOL_PREVIEW_MAX = 96

export const $subagentsBySession = atom<Record<string, SubagentProgress[]>>({})
let revision = 0

const commitSubagents = (next: Record<string, SubagentProgress[]>) => {
  revision += 1
  $subagentsBySession.set(next)
}

/** Monotonic renderer-side mutation counter used to reject stale async
 * delegation snapshots that raced a newer stream event. */
export const subagentStoreRevision = () => revision

export const $runningSubagentSessionIds = computed($subagentsBySession, groups => {
  const ids = new Set<string>()

  for (const items of Object.values(groups)) {
    for (const item of items) {
      if (item.sessionId && (item.status === 'queued' || item.status === 'running')) {
        ids.add(item.sessionId)
      }
    }
  }

  return [...ids]
})

const isStr = (v: unknown): v is string => typeof v === 'string'
const str = (v: unknown) => (isStr(v) ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const strList = (v: unknown) => (Array.isArray(v) ? v.filter(isStr) : [])

const asStatus = (v: unknown): SubagentStatus =>
  v === 'completed' || v === 'failed' || v === 'interrupted' || v === 'queued' ? v : 'running'

const compact = (text: string, max = PREVIEW_MAX) => {
  const line = text.replace(/\s+/g, ' ').trim()

  if (!line) {
    return ''
  }

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const toolLabel = (name: string) => name.split('_').filter(Boolean).map(capitalize).join(' ') || name

const formatTool = (name: string, preview = '') => {
  const snippet = compact(preview, TOOL_PREVIEW_MAX)

  return snippet ? `${toolLabel(name)}("${snippet}")` : toolLabel(name)
}

interface TailEntry {
  isError?: boolean
  preview?: string
  tool?: string
}

const asTail = (v: unknown): TailEntry[] =>
  Array.isArray(v)
    ? v
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(item => ({
          isError: item.is_error === true,
          preview: str(item.preview) || undefined,
          tool: str(item.tool) || undefined
        }))
    : []

const idOf = (p: SubagentPayload) =>
  str(p.subagent_id) || `${str(p.parent_id) || 'root'}:${num(p.task_index) ?? 0}:${str(p.goal)}`

const appendStream = (stream: SubagentStreamEntry[], entry: SubagentStreamEntry) => {
  const last = stream.at(-1)

  if (last?.kind === entry.kind && last.text === entry.text && last.isError === entry.isError) {
    return stream
  }

  return [...stream, entry].slice(-MAX_STREAM)
}

function streamFromPayload(
  payload: SubagentPayload,
  status: SubagentStatus,
  eventType: string,
  at: number
): SubagentStreamEntry[] {
  const out: SubagentStreamEntry[] = []
  const tool = str(payload.tool_name)
  const preview = str(payload.tool_preview) || str(payload.text)
  const text = compact(str(payload.text) || preview)

  for (const tail of asTail(payload.output_tail)) {
    const line = tail.tool ? formatTool(tail.tool, tail.preview ?? '') : compact(tail.preview ?? '')

    if (line) {
      out.push({ at, isError: tail.isError, kind: tail.tool ? 'tool' : 'progress', text: line })
    }
  }

  if (tool) {
    out.push({ at, isError: !!payload.error, kind: 'tool', text: formatTool(tool, preview) })
  }

  if (eventType === 'subagent.progress' && text) {
    out.push({ at, isError: !!payload.error, kind: 'progress', text })
  }

  if (eventType === 'subagent.thinking' && text) {
    out.push({ at, kind: 'thinking', text })
  }

  const summary = compact(str(payload.summary) || str(payload.text))

  if (TERMINAL.has(status) && summary) {
    out.push({ at, isError: status === 'failed', kind: 'summary', text: summary })
  }

  return out
}

function toProgress(payload: SubagentPayload, prev: SubagentProgress | undefined, eventType = ''): SubagentProgress {
  const at = Date.now()
  const status = asStatus(payload.status)
  const startedAtSeconds = num(payload.started_at)
  const tool = str(payload.tool_name)
  const stream = streamFromPayload(payload, status, eventType, at).reduce(appendStream, prev?.stream ?? [])
  const filesRead = strList(payload.files_read)
  const filesWritten = strList(payload.files_written)

  return {
    id: prev?.id ?? idOf(payload),
    parentId: str(payload.parent_id) || prev?.parentId || null,
    parentSessionId: str(payload.parent_session_id) || prev?.parentSessionId,
    goal: str(payload.goal) || prev?.goal || 'Subagent',
    sessionId: str(payload.child_session_id) || prev?.sessionId,
    model: str(payload.model) || prev?.model,
    profile: str(payload.profile) || prev?.profile,
    status,
    taskCount: num(payload.task_count) ?? prev?.taskCount ?? 1,
    taskIndex: num(payload.task_index) ?? prev?.taskIndex ?? 0,
    startedAt: prev?.startedAt ?? (startedAtSeconds ? startedAtSeconds * 1000 : at),
    updatedAt: at,
    durationSeconds: num(payload.duration_seconds) ?? prev?.durationSeconds,
    costUsd: num(payload.cost_usd) ?? prev?.costUsd,
    inputTokens: num(payload.input_tokens) ?? prev?.inputTokens,
    outputTokens: num(payload.output_tokens) ?? prev?.outputTokens,
    toolCount: num(payload.tool_count) ?? prev?.toolCount,
    filesRead: filesRead.length ? filesRead : (prev?.filesRead ?? []),
    filesWritten: filesWritten.length ? filesWritten : (prev?.filesWritten ?? []),
    stream,
    summary: str(payload.summary) || prev?.summary,
    currentTool: TERMINAL.has(status) ? undefined : tool || prev?.currentTool
  }
}

export function clearSessionSubagents(sid: string) {
  const map = $subagentsBySession.get()

  if (!(sid in map)) {
    return
  }

  const { [sid]: _drop, ...rest } = map
  commitSubagents(rest)
}

/**
 * Prune terminal-status subagent rows for a session, leaving running/queued
 * entries untouched. Used at the `message.start` boundary in the desktop
 * message-stream hook so that the *previous* turn's finished rows get flushed
 * from the display while background subagents that outlived the spawning turn
 * remain visible (and still accept late progress/complete events).
 *
 * Distinct from `clearSessionSubagents` (used by the Stop action, which
 * genuinely cancels running subagents and so should drop them all) and from
 * `pruneDelegateFallbackSubagents` (which filters by id prefix to remove
 * placeholder rows once the real native event arrives).
 */
export function pruneFinishedSessionSubagents(sid: string) {
  const map = $subagentsBySession.get()
  const list = map[sid]

  if (!list?.length) {
    return
  }

  const next = list.filter(item => item.status === 'running' || item.status === 'queued')

  if (next.length === list.length) {
    return
  }

  commitSubagents({ ...map, [sid]: next })
}

export function pruneDelegateFallbackSubagents(sid: string) {
  const map = $subagentsBySession.get()
  const list = map[sid]

  if (!list?.length) {
    return
  }

  const next = list.filter(item => !item.id.startsWith('delegate-tool:'))

  if (next.length === list.length) {
    return
  }

  commitSubagents({ ...map, [sid]: next })
}

export function upsertSubagent(sid: string, payload: SubagentPayload, createIfMissing = true, eventType?: string) {
  const map = $subagentsBySession.get()
  const list = map[sid] ?? []
  const id = idOf(payload)
  const idx = list.findIndex(item => item.id === id)

  if (idx < 0 && !createIfMissing) {
    return
  }

  const prev = idx >= 0 ? list[idx] : undefined

  if (prev && TERMINAL.has(prev.status)) {
    return
  }

  const next = toProgress(payload, prev, eventType)
  const nextList = idx >= 0 ? list.map(item => (item.id === id ? next : item)) : [...list, next]

  commitSubagents({ ...map, [sid]: nextList })
}

/** Rebuild the renderer's active-agent cache from `delegation.status` after a
 * reconnect/restart. The snapshot is authoritative for active rows: stale
 * running placeholders disappear, while terminal rows already rendered in the
 * current renderer are retained. */
export function reconcileActiveSubagents(
  active: readonly SubagentPayload[],
  runtimeIdForParent: (parentSessionId: string) => string = parentSessionId => parentSessionId,
  shouldReconcile: (sid: string, item: SubagentProgress) => boolean = () => true
) {
  const current = $subagentsBySession.get()
  const previousById = new Map(Object.values(current).flat().map(item => [item.id, item]))
  const next: Record<string, SubagentProgress[]> = {}

  for (const [sid, items] of Object.entries(current)) {
    const terminal = items.filter(item => TERMINAL.has(item.status) || !shouldReconcile(sid, item))

    if (terminal.length > 0) {
      next[sid] = terminal
    }
  }

  for (const payload of active) {
    const parentSessionId = str(payload.parent_session_id)
    const id = idOf(payload)

    if (!parentSessionId || !id) {
      continue
    }

    const sid = runtimeIdForParent(parentSessionId) || parentSessionId
    const item = toProgress({ ...payload, status: 'running' }, previousById.get(id), 'subagent.start')
    next[sid] = [...(next[sid] ?? []).filter(existing => existing.id !== item.id), item]
  }

  commitSubagents(next)
}

export function buildSubagentTree(items: readonly SubagentProgress[]): SubagentNode[] {
  const nodes = new Map<string, SubagentNode>()

  for (const item of items) {
    nodes.set(item.id, { ...item, children: [] })
  }

  const roots: SubagentNode[] = []

  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null

    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sort = (a: SubagentNode, b: SubagentNode) =>
    a.startedAt - b.startedAt || a.taskIndex - b.taskIndex || a.goal.localeCompare(b.goal)

  const walk = (node: SubagentNode) => node.children.sort(sort).forEach(walk)
  roots.sort(sort).forEach(walk)

  return roots
}

export const activeSubagentCount = (items: readonly SubagentProgress[]) =>
  items.filter(item => item.status === 'queued' || item.status === 'running').length

export const failedSubagentCount = (items: readonly SubagentProgress[]) =>
  items.filter(item => item.status === 'failed' || item.status === 'interrupted').length

/** Flatten every session's subagents — the scope the Spawn-tree panel and the
 *  status-bar indicator must agree on. */
export const allSubagents = (bySession: Record<string, SubagentProgress[]>) => Object.values(bySession).flat()

/** Optimistic child-session rows for the project tree. Delegate events arrive
 * before the child has necessarily flushed its DB session, so waiting for the
 * next full project-tree reload made the sidebar appear stale. These rows use
 * the spawning parent's workspace metadata and are naturally replaced (same
 * durable id) when the backend snapshot catches up. */
export function activeSubagentSessionRows(
  groups: Record<string, SubagentProgress[]>,
  parentSessions: readonly SessionInfo[]
): SessionInfo[] {
  const parentById = new Map<string, SessionInfo>()

  for (const parent of parentSessions) {
    parentById.set(parent.id, parent)

    if (parent._lineage_root_id) {
      parentById.set(parent._lineage_root_id, parent)
    }
  }

  const rows: SessionInfo[] = []
  const seen = new Set<string>()

  const active = allSubagents(groups)
    .filter(item => (item.status === 'queued' || item.status === 'running') && item.sessionId && item.parentSessionId)
    .sort((a, b) => a.startedAt - b.startedAt)

  for (const item of active) {
    const childSessionId = item.sessionId as string
    const parentSessionId = item.parentSessionId as string
    const parent = parentById.get(parentSessionId)

    if (!parent || seen.has(childSessionId)) {
      continue
    }

    const row: SessionInfo = {
      ...parent,
      _lineage_root_id: childSessionId,
      actual_cost_usd: null,
      archived: false,
      delegate_parent_session_id: parentSessionId,
      ended_at: null,
      estimated_cost_usd: null,
      id: childSessionId,
      input_tokens: 0,
      is_active: true,
      last_active: Math.floor(item.updatedAt / 1000),
      message_count: 0,
      model: item.model ?? parent.model,
      output_tokens: 0,
      parent_session_id: parent.id,
      pinned: false,
      preview: item.goal,
      running: true,
      source: 'subagent',
      started_at: Math.floor(item.startedAt / 1000),
      title: item.goal,
      tool_call_count: item.toolCount ?? 0
    }

    seen.add(childSessionId)
    rows.push(row)
    parentById.set(childSessionId, row)
  }

  return rows
}
