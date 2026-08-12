/**
 * Task drawer — the desktop port of the dashboard's task detail, flat-styled:
 * status menu + meta table, DIAGNOSTICS (the "why is this stuck" panel, with
 * reassign recovery), description (editable), result/summary, dependencies,
 * comments (+composer), activity, run history, and the worker log tail.
 */

import {
  Badge,
  Button,
  cn,
  Codicon,
  compactNumber,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  host,
  Loader,
  LogView,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tip,
  useMutation,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { type ClipboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import {
  $boardSlug,
  addComment,
  deleteTask,
  estimateTask,
  fetchLog,
  fetchProfiles,
  fetchTask,
  logKey,
  patchTask,
  PROFILES_KEY,
  reassignTask,
  reclaimTask,
  taskKey,
  uploadAttachment,
  uploadPastedImage
} from './api'
import { KanbanCommentBody } from './comment-body'
import { ModelOverrideField, overridePatch, type TaskModelOverride } from './model-override'
import { attachmentMarkdownUrl, buildPastedImageComment, clipboardImageFiles, PastedImageUploadGuard } from './paste-images'
import {
  type Diagnostic,
  type DiagnosticAction,
  type KanbanAttachment,
  type KanbanEvent,
  type KanbanRun,
  type KanbanTaskDetail,
  type KanbanTaskFull,
  type KanbanTaskLink,
  SEVERITY_TONE,
  type TaskEstimate,
  type WorkerLog
} from './types'
import {
  ago,
  Avatar,
  Callout,
  columnLabel,
  duration,
  errText,
  isLockedTarget,
  type KanbanText,
  lockedReason,
  ScrollFade,
  Section,
  shortId,
  StatusMenu,
  useDefaultAssignee,
  useKanban
} from './ui'

/**
 * Turn a task_events row into an operator-readable line. The backend logs
 * machine payloads ("status" + {"status":"ready"}); rendering the raw kind
 * made the feed useless ("status · 2 sec. ago" after a drag). Known kinds get
 * prose with the payload folded in; unknown kinds fall back to kind + compact
 * key=value detail so new backend events still say something.
 */
function eventText(event: KanbanEvent, k: KanbanText): { detail?: string; label: string } {
  let p: Record<string, unknown> = {}

  if (typeof event.payload === 'string' && event.payload) {
    try {
      p = JSON.parse(event.payload) as Record<string, unknown>
    } catch {
      return { label: event.kind.replace(/_/g, ' '), detail: event.payload }
    }
  } else if (event.payload && typeof event.payload === 'object') {
    p = event.payload as Record<string, unknown>
  }

  const str = (key: string): null | string => {
    const value = p[key]

    return typeof value === 'string' && value ? value : null
  }

  const col = (key: string) => {
    const value = str(key)

    return value ? columnLabel(k, value) : null
  }

  switch (event.kind) {
    case 'created':
      return { label: k.evtCreated(col('status') ?? '', str('assignee') ?? '') }
    case 'status': {
      const reason = str('reason')

      return {
        label: k.evtMovedTo(col('status') ?? '?'),
        detail: reason === 'parent_reopened' ? k.evtParentReopened(str('parent') ?? '') : (reason ?? undefined)
      }
    }

    case 'assigned': {
      const assignee = str('assignee')

      return { label: assignee ? k.evtAssignedTo(assignee) : k.evtUnassigned }
    }

    case 'commented':
      return { label: k.evtCommentBy(str('author') ?? k.someone) }

    case 'claimed':
      return { label: str('source_status') === 'review' ? k.evtClaimedReview : k.evtClaimedWorker }

    case 'spawned':
      return { label: k.evtWorkerStarted, detail: p.pid != null ? `pid ${p.pid}` : undefined }

    case 'completed':
      return { label: k.evtCompleted }

    case 'blocked':
      return { label: k.evtBlocked, detail: str('reason') ?? undefined }

    case 'unblocked':
      return { label: k.evtUnblocked(col('status') ?? '') }

    case 'reclaimed':
      return { label: k.evtReclaimed, detail: str('reason') ?? undefined }

    case 'specified':
      return { label: k.evtSpecified }

    case 'promoted':
      return { label: k.evtPromoted }

    case 'scheduled':
      return { label: k.evtScheduled, detail: str('reason') ?? undefined }

    case 'archived':
      return { label: k.evtArchived }

    case 'reprioritized':
      return { label: k.evtReprioritized(String(p.priority ?? '?')) }
    default: {
      const detail = Object.entries(p)
        .filter(([, value]) => value != null && typeof value !== 'object')
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')

      return { label: event.kind.replace(/_/g, ' '), detail: detail || undefined }
    }
  }
}

type TimelineTone = 'current' | 'done' | 'error' | 'pending' | 'warning'

interface TimelineItem {
  actionTrace?: string[]
  at?: null | number
  detail?: string
  id: string
  label: string
  tone: TimelineTone
}

const EVENT_TONES: Record<string, TimelineTone> = {
  blocked: 'error',
  completed: 'done',
  reclaimed: 'warning',
  scheduled: 'pending'
}

const TERMINAL_STATUSES = new Set(['archived', 'blocked', 'done', 'review'])
const WORKER_ACTION_TRACE_LIMIT = 20

function parseEventPayload(event: KanbanEvent): Record<string, unknown> {
  if (!event.payload) {
    return {}
  }

  if (typeof event.payload === 'string') {
    try {
      return JSON.parse(event.payload) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  return typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}
}

function stripAnsi(text: string): string {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g'), '')
}

const trimAction = (value: string, max = 150): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

function stripLogLineChrome(line: string): string {
  return line
    .replace(/^[\s│┃┊╭╰├└┌┐┘┴┬─$|]+/, '')
    .replace(/\s+\d+(?:\.\d+)?s(?:\s+\[[^\]]+\])?\s*$/, '')
    .trim()
}

function humanizeWorkerLogLine(line: string): null | string {
  const cleaned = stripLogLineChrome(line)

  if (
    !cleaned ||
    cleaned === '$' ||
    /^[^\w]*\$\s*$/.test(cleaned) ||
    /^[-=]{3,}$/.test(cleaned) ||
    /^(?:Query:|Initializing agent|Resume this session with:|Session:|Title:|Duration:|Messages:)\b/.test(cleaned) ||
    /^\/[^|]+$/.test(cleaned)
  ) {
    return null
  }

  const action = cleaned.replace(/^(?:[^\w/$]+\s*)+/u, '').replace(/\s+/g, ' ').trim()

  if (!action) {
    return null
  }

  if (action.startsWith('$ ')) {
    return trimAction(`running command: ${action.slice(2).trim()}`)
  }

  const [verb, ...rest] = action.split(' ')
  const target = rest.join(' ').trim()
  const compactTarget = trimAction(target || action, 120)

  switch (verb) {
    case 'find':
      return `finding files: ${compactTarget}`

    case 'grep':
      return `searching code for: ${compactTarget}`

    case 'kanban_co':
      return 'updating the kanban task'

    case 'kanban_sh':
      return 'loading the kanban task'

    case 'patch':
      return `editing files: ${compactTarget}`

    case 'plan':
      return target ? `updating plan: ${compactTarget}` : 'updating the work plan'

    case 'read':
      return `reading file: ${compactTarget}`

    case 'skill':
      return `loading skill: ${compactTarget}`

    case 'vision':
      return `inspecting image: ${compactTarget}`

    case 'write':
      return `writing file: ${compactTarget}`

    default:
      return trimAction(action)
  }
}

function workerLogActions(log?: WorkerLog, limit = WORKER_ACTION_TRACE_LIMIT): string[] {
  if (!log?.content) {
    return []
  }

  const actions = stripAnsi(log.content)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => humanizeWorkerLogLine(line))
    .filter((action): action is string => Boolean(action))

  return actions.slice(-limit)
}

function latestWorkerLogAction(log?: WorkerLog): null | string {
  return workerLogActions(log, 1)[0] ?? null
}

function latestRun(runs: KanbanRun[]): KanbanRun | undefined {
  return [...runs].sort((a, b) => Number(b.started_at ?? 0) - Number(a.started_at ?? 0) || Number(b.id) - Number(a.id))[0]
}

function currentStatusLabel(task: KanbanTaskFull, run: KanbanRun | undefined, log: WorkerLog | undefined, k: KanbanText) {
  const runDuration = run ? duration(run.started_at, run.ended_at) : null
  const parts: string[] = []

  if (run?.profile) {
    parts.push(runDuration ? k.timelineRunDetail(run.profile, runDuration) : k.timelineRunProfile(run.profile))
  }

  if (task.last_heartbeat_at) {
    const lastHeartbeat = ago(task.last_heartbeat_at)

    if (lastHeartbeat) {
      parts.push(k.timelineLastHeartbeat(lastHeartbeat))
    }
  }

  const action = latestWorkerLogAction(log)

  if (action && task.status !== 'running') {
    parts.push(k.timelineLastAction(action))
  }

  switch (task.status) {
    case 'running':
      return { detail: parts.join(' · ') || undefined, label: k.timelineWorking, tone: 'current' as const }

    case 'blocked':
      return { detail: task.last_failure_error ?? (parts.join(' · ') || undefined), label: k.timelineNeedsInput, tone: 'error' as const }

    case 'review':
      return { detail: parts.join(' · ') || undefined, label: k.timelineReview, tone: 'current' as const }

    case 'done':
      return { detail: task.latest_summary ?? task.result ?? (parts.join(' · ') || undefined), label: k.timelineCompleted, tone: 'done' as const }

    case 'archived':
      return { detail: parts.join(' · ') || undefined, label: k.timelineArchived, tone: 'done' as const }

    default:
      return {
        detail: task.assignee ? k.timelineAssigned(task.assignee) : k.timelineNoAssignee,
        label: k.timelineWaitingIn(columnLabel(k, task.status)),
        tone: task.assignee ? ('pending' as const) : ('warning' as const)
      }
  }
}

export function buildTimelineItems(detail: KanbanTaskDetail, log: WorkerLog | undefined, k: KanbanText): TimelineItem[] {
  const items: TimelineItem[] = []
  const seen = new Set<string>()

  const push = (item: TimelineItem) => {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      items.push(item)
    }
  }

  if (detail.task.created_at) {
    push({ at: detail.task.created_at, id: 'task-created', label: k.timelineCreated, tone: 'done' })
  }

  if (detail.task.assignee) {
    push({ id: 'task-assignee', label: k.timelineAssigned(detail.task.assignee), tone: 'done' })
  }

  for (const event of detail.events) {
    if (event.kind === 'heartbeat') {
      continue
    }

    const { detail: extra, label } = eventText(event, k)
    const payload = parseEventPayload(event)
    const tone = EVENT_TONES[event.kind] ?? 'done'

    push({
      at: event.created_at,
      detail: extra,
      id: `event-${event.id}`,
      label: event.kind === 'commented' ? k.timelineCommented(String(payload.author ?? k.someone)) : label,
      tone
    })
  }

  const run = latestRun(detail.runs)
  const current = currentStatusLabel(detail.task, run, log, k)

  if (TERMINAL_STATUSES.has(detail.task.status) && current.tone === 'done') {
    push({
      at: detail.task.completed_at ?? run?.ended_at ?? run?.started_at ?? detail.task.last_heartbeat_at ?? detail.task.created_at,
      detail: current.detail,
      id: `current-${detail.task.status}`,
      label: current.label,
      tone: current.tone
    })
  } else {
    const actionTrace = detail.task.status === 'running' ? workerLogActions(log) : []

    push({
      actionTrace: actionTrace.length > 0 ? actionTrace : undefined,
      at: detail.task.last_heartbeat_at ?? run?.started_at ?? detail.task.created_at,
      detail: current.detail,
      id: `current-${detail.task.status}`,
      label: current.label,
      tone: current.tone
    })
  }

  return items
}

function TimelineSection({ collapsible = false, detail, log }: { collapsible?: boolean; detail: KanbanTaskDetail; log?: WorkerLog }) {
  const k = useKanban()
  const items = buildTimelineItems(detail, log, k)
  const timelineCount = items.reduce((count, item) => count + 1 + (item.actionTrace?.length ?? 0), 0)

  const iconFor = (tone: TimelineTone) => {
    switch (tone) {
      case 'current':
        return 'sync'

      case 'error':
        return 'error'

      case 'warning':
        return 'warning'

      case 'pending':
        return 'circle-outline'

      default:
        return 'check'
    }
  }

  const toneClass = (tone: TimelineTone) => {
    switch (tone) {
      case 'current':
        return 'border-emerald-400/60 bg-emerald-400/10 text-emerald-300'

      case 'error':
        return 'border-destructive/60 bg-destructive/10 text-destructive'

      case 'warning':
        return 'border-amber-400/60 bg-amber-400/10 text-amber-300'

      case 'pending':
        return 'border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary) text-(--ui-text-quaternary)'

      default:
        return 'border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary) text-(--ui-text-secondary)'
    }
  }

  if (!items.length) {
    return (
      <Section label={k.timeline(0)}>
        <p className="text-[0.75rem] text-(--ui-text-quaternary)">{k.timelineNoActivity}</p>
      </Section>
    )
  }

  return (
    <Section collapsible={collapsible} label={k.timeline(timelineCount)}>
      <ScrollFade deps={items.length} max="14rem">
        <ol className="flex flex-col gap-2">
          {items.map(item => (
            <li className="flex gap-2 text-[0.75rem]" key={item.id}>
              <span
                className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border', toneClass(item.tone))}
              >
                <Codicon name={iconFor(item.tone)} size="0.72rem" spinning={item.tone === 'current'} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-medium text-(--ui-text-secondary)">{item.label}</span>
                  {ago(item.at) && (
                    <span className="ml-auto shrink-0 text-[0.625rem] text-(--ui-text-quaternary)">{ago(item.at)}</span>
                  )}
                </span>
                {item.detail && (
                  <span className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)">
                    {item.detail}
                  </span>
                )}
                {item.actionTrace && item.actionTrace.length > 0 && (
                  <span className="mt-1 flex flex-col gap-0.5">
                    {item.actionTrace.map((action, index) => (
                      <span
                        className="line-clamp-2 whitespace-pre-wrap text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)"
                        key={`${item.id}-action-${index}`}
                      >
                        {action}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </ScrollFade>
    </Section>
  )
}

function MetaRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <>
      <span className="text-(--ui-text-quaternary)">{label}</span>
      <span className="min-w-0 truncate text-(--ui-text-secondary)">{children}</span>
    </>
  )
}

function DrawerTabContent({ children, value }: { children: ReactNode; value: string }) {
  return (
    <TabsContent className="min-h-0 flex-col gap-4 data-[state=active]:flex data-[state=inactive]:hidden" value={value}>
      {children}
    </TabsContent>
  )
}

function DetailMetaGrid({
  onModelChange,
  onReassign,
  task
}: {
  onModelChange: (next: TaskModelOverride) => void
  onReassign: (profile: string) => void
  task: KanbanTaskFull
}) {
  const k = useKanban()
  const running = task.status === 'running'

  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.71rem]">
      <MetaRow label={k.assignee}>
        <AssigneeMenu current={task.assignee} onReassign={onReassign} />
      </MetaRow>
      {typeof task.priority === 'number' && <MetaRow label={k.metaPriority}>{task.priority}</MetaRow>}
      {task.tenant && <MetaRow label={k.metaTenant}>{task.tenant}</MetaRow>}
      {task.workspace_path && (
        <MetaRow label={k.workspace}>
          {task.workspace_kind ? `${task.workspace_kind}: ` : ''}
          {task.workspace_path}
        </MetaRow>
      )}
      <MetaRow label={k.model}>
        <ModelOverrideField
          onChange={onModelChange}
          value={{
            effort: task.reasoning_effort ?? '',
            model: task.model_override ?? '',
            provider: task.provider_override ?? ''
          }}
        />
      </MetaRow>
      {task.created_by && <MetaRow label={k.metaCreatedBy}>{task.created_by}</MetaRow>}
      {ago(task.created_at) && <MetaRow label={k.metaCreated}>{ago(task.created_at)}</MetaRow>}
      {running && task.worker_pid ? <MetaRow label={k.metaWorkerPid}>{task.worker_pid}</MetaRow> : null}
    </div>
  )
}

const linkedTaskLabel = (link: KanbanTaskLink): string => link.title?.trim() || shortId(link.id)

function linkedTasks(detail: KanbanTaskDetail, side: 'children' | 'parents'): KanbanTaskLink[] {
  const details = detail.link_details?.[side]
  const byId = new Map(details?.map(link => [link.id, link]))

  return detail.links[side].map(id => byId.get(id) ?? { id })
}

export function DependenciesSection({ detail, onOpen }: { detail: KanbanTaskDetail; onOpen: (id: string) => void }) {
  const k = useKanban()

  return (
    <Section label={k.dependencies}>
      {(['parents', 'children'] as const).map(side => {
        const links = linkedTasks(detail, side)

        return links.length > 0 ? (
          <div className="flex flex-col gap-1" key={side}>
            <span className="text-[0.6875rem] text-(--ui-text-quaternary)">
              {side === 'parents' ? k.blockedBy : k.blocks}
            </span>
            <div className="flex flex-col gap-1">
              {links.map(link => {
                const label = linkedTaskLabel(link)

                return (
                  <button
                    className="min-w-0 rounded bg-(--ui-bg-quaternary) px-1.5 py-1 text-left text-[0.6875rem] text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
                    key={link.id}
                    onClick={() => onOpen(link.id)}
                    title={`${label} (${link.id})`}
                    type="button"
                  >
                    <span className="block truncate">{label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null
      })}
    </Section>
  )
}

/** The dashboard's diagnostics panel: severity-toned, plain-English, with the
 *  backend's structured recovery actions as buttons. `reassign` is skipped —
 *  the Assignee control in the meta table IS that action, inline. */
function Diagnostics({ items, onReclaim }: { items: Diagnostic[]; onReclaim: () => void }) {
  const k = useKanban()

  const act = (action: DiagnosticAction) => {
    if (action.kind === 'reclaim') {
      onReclaim()
    } else if (action.kind === 'cli_hint') {
      void navigator.clipboard.writeText(String(action.payload?.command ?? action.label))
      host.notify({ kind: 'info', message: k.commandCopied })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map(diag => {
        const tone = SEVERITY_TONE[diag.severity]
        const actions = diag.actions.filter(action => action.kind === 'reclaim' || action.kind === 'cli_hint')

        return (
          <Callout
            key={`${diag.kind}-${diag.last_seen_at}`}
            title={`${diag.title}${diag.count > 1 ? ` ×${diag.count}` : ''}`}
            tone={tone}
          >
            <p className="whitespace-pre-wrap text-[0.71rem] leading-relaxed text-(--ui-text-secondary)">
              {diag.detail}
            </p>
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {actions.map(action => (
                  <Button
                    key={`${action.kind}-${action.label}`}
                    onClick={() => act(action)}
                    size="xs"
                    variant={action.suggested ? 'secondary' : 'outline'}
                  >
                    {action.kind === 'cli_hint' && <Codicon name="copy" size="0.7rem" />}
                    {action.label}
                  </Button>
                ))}
              </div>
            )}
          </Callout>
        )
      })}
    </div>
  )
}

/** Jira-style inline assignee editor: the meta row IS the control — click the
 *  assignee to reassign (reclaims a running worker first, resets the failure
 *  streak — the explicit human recovery action). */
function AssigneeMenu({
  current,
  onReassign
}: {
  current: null | string | undefined
  onReassign: (p: string) => void
}) {
  const k = useKanban()
  const { data: roster } = useQuery({ queryKey: PROFILES_KEY, queryFn: fetchProfiles, staleTime: 60_000 })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="-mx-1 inline-flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-(--chrome-action-hover)"
          type="button"
        >
          {current ? (
            <>
              <Avatar name={current} size="0.875rem" />
              <span className="truncate">{current}</span>
            </>
          ) : (
            <span className="text-(--ui-text-quaternary)">{k.unassigned}</span>
          )}
          <Codicon className="shrink-0 text-(--ui-text-quaternary)" name="chevron-down" size="0.65rem" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {(roster?.profiles ?? []).map(profile => (
          <DropdownMenuItem key={profile.name} onSelect={() => onReassign(profile.name)}>
            <Avatar name={profile.name} size="0.875rem" />
            {profile.name}
            {profile.name === current && <Codicon className="ml-auto" name="check" size="0.8rem" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Mirrors the review pane's commit-message field: one row tall to start
// (button-height), CSS field-sizing grows it with content, button hugs the
// bottom edge as it grows.
//
// On a RUNNING task the worker polls its comment thread and folds new notes
// into the live turn (OUT-OF-BAND steer), so a plain note reaches the agent
// mid-run within a few seconds — no block/unblock dance. `onRequeue` is the
// heavier option: post the note AND reclaim so the task restarts from scratch
// with the note in context (use when the current run has gone off the rails).
export function CommentComposer({
  onPasteImages,
  onRequeue,
  onSubmit,
  pending,
  running
}: {
  onPasteImages?: (files: File[]) => KanbanAttachment[] | Promise<KanbanAttachment[]> | Promise<void> | void
  onRequeue?: (body: string) => void
  onSubmit: (body: string) => void
  pending: boolean
  running?: boolean
}) {
  const k = useKanban()
  const [body, setBody] = useState('')
  const [pastedImages, setPastedImages] = useState<KanbanAttachment[]>([])

  const commentBody = () => buildPastedImageComment(body, pastedImages)

  const submit = () => {
    const trimmed = commentBody().trim()

    if (trimmed && !pending) {
      onSubmit(trimmed)
      setBody('')
      setPastedImages([])
    }
  }

  const requeue = () => {
    const trimmed = commentBody().trim()

    if (trimmed && !pending && onRequeue) {
      onRequeue(trimmed)
      setBody('')
      setPastedImages([])
    }
  }

  const pasteImages = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = clipboardImageFiles(event.clipboardData)

    if (!files.length || pending || !onPasteImages) {
      return
    }

    event.preventDefault()
    void Promise.resolve(onPasteImages(files)).then(
      attachments => {
        if (Array.isArray(attachments) && attachments.length > 0) {
          setPastedImages(current => [...current, ...attachments])
        }
      },
      () => undefined
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Textarea
          className={cn('field-sizing-content max-h-40 min-h-0 resize-none', running ? 'pr-[3.5rem]' : 'pr-[5rem]')}
          onChange={event => setBody(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          onPaste={pasteImages}
          placeholder={running ? k.messageWorker : k.addComment}
          rows={1}
          size="sm"
          value={body}
        />
        <Button
          className="absolute top-1 right-1"
          disabled={!commentBody().trim() || pending}
          onClick={submit}
          size="xs"
          variant="secondary"
        >
          {running ? k.send : k.comment}
        </Button>
      </div>
      {pastedImages.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {pastedImages.map(attachment => (
            <li
              className="group relative overflow-hidden rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary)"
              key={attachment.id}
            >
              <img
                alt={attachment.filename || 'pasted image'}
                className="h-16 w-16 object-cover"
                src={attachmentMarkdownUrl(attachment)}
              />
              <button
                aria-label={`Remove ${attachment.filename || 'pasted image'} from comment preview`}
                className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded bg-black/65 text-white opacity-90 transition-opacity group-hover:opacity-100"
                onClick={() => setPastedImages(current => current.filter(item => item.id !== attachment.id))}
                type="button"
              >
                <Codicon name="close" size="0.65rem" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {running && onRequeue && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.625rem] leading-tight text-(--ui-text-quaternary)">{k.deliveredLive}</span>
          <Button className="shrink-0" disabled={!commentBody().trim() || pending} onClick={requeue} size="xs" variant="outline">
            <Codicon name="debug-restart" size="0.7rem" />
            {k.requeueWithNote}
          </Button>
        </div>
      )}
    </div>
  )
}

function DescriptionSection({ body, onSave }: { body: null | string | undefined; onSave: (body: string) => void }) {
  const k = useKanban()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  return (
    <Section
      action={
        <Button
          aria-label={editing ? k.cancelEdit : k.editDescription}
          onClick={() => {
            setDraft(body ?? '')
            setEditing(!editing)
          }}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name={editing ? 'close' : 'edit'} size="0.75rem" />
        </Button>
      }
      label={k.description}
    >
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <Textarea
            className="min-h-24 text-[0.75rem]"
            onChange={event => setDraft(event.target.value)}
            value={draft}
          />
          <Button
            className="self-end"
            onClick={() => {
              onSave(draft)
              setEditing(false)
            }}
            size="xs"
            variant="secondary"
          >
            {k.save}
          </Button>
        </div>
      ) : body ? (
        <p className="whitespace-pre-wrap text-[0.8125rem] text-(--ui-text-secondary)">{body}</p>
      ) : (
        <p className="text-[0.8125rem] text-(--ui-text-quaternary)">{k.noDescription}</p>
      )}
    </Section>
  )
}

// `latest_summary` is just the newest non-null run summary. A reclaim writes an
// administrative note into that slot; hide those (Runs still shows them).
const isAdminSummary = (summary: string) => /^status changed to \w+ \(dashboard\/direct\)$/.test(summary)

export function AttachmentsSection({
  attachments,
  onPasteImages,
  onUpload,
  pending
}: {
  attachments: KanbanAttachment[]
  onPasteImages?: (files: File[]) => Promise<unknown> | unknown
  onUpload: (file: File) => void
  pending: boolean
}) {
  const k = useKanban()
  const fileRef = useRef<HTMLInputElement>(null)

  const pasteImages = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = clipboardImageFiles(event.clipboardData)

    if (!files.length || pending || !onPasteImages) {
      return
    }

    event.preventDefault()
    void Promise.resolve(onPasteImages(files))
  }

  return (
    <Section
      action={
        <>
          <input
            hidden
            onChange={event => {
              const file = event.target.files?.[0]

              if (file) {
                onUpload(file)
              }

              event.target.value = ''
            }}
            ref={fileRef}
            type="file"
          />
          <Button
            aria-label={k.uploadAttachment}
            disabled={pending}
            onClick={() => fileRef.current?.click()}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name={pending ? 'sync' : 'cloud-upload'} size="0.8rem" spinning={pending} />
          </Button>
        </>
      }
      label={k.attachments(attachments.length)}
    >
      <div onPaste={pasteImages} tabIndex={0} title="Paste images here to add them as attachments">
        {attachments.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {attachments.map(attachment => (
              <li className="flex items-center gap-1.5 text-[0.75rem] text-(--ui-text-tertiary)" key={attachment.id}>
                <Codicon name="file" size="0.75rem" />
                {attachment.filename}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.75rem] text-(--ui-text-quaternary)">{k.noAttachments}</p>
        )}
      </div>
    </Section>
  )
}

// Rough effort estimate via the auxiliary (auto-routed) model. Tokens +
// complexity, never dollars — providers don't report cost reliably. Gated
// behind an explicit click + disclaimer since it makes a model call. The
// control keeps a stable footprint (spinner swaps in place) so there's no
// layout jump when it runs.
function EstimateSection({ id }: { id: string }) {
  const k = useKanban()
  const [result, setResult] = useState<null | TaskEstimate>(null)

  const est = useMutation({
    mutationFn: () => estimateTask(id),
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSuccess: r => {
      if (r.ok) {
        setResult(r)
      } else {
        host.notify({ kind: 'warning', message: r.reason || k.couldNotEstimate })
      }
    }
  })

  // A new task resets the cached estimate (the drawer reuses one instance).
  useEffect(() => setResult(null), [id])

  return (
    <Section label={k.estimate}>
      {result?.ok ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[0.8125rem]">
            <span className="font-medium tabular-nums text-(--ui-text-secondary)">
              ~{compactNumber(result.est_tokens)} {k.tokUnit}
            </span>
            {result.complexity && (
              <span className="text-(--ui-text-tertiary)">
                · {k.complexity[result.complexity] ?? result.complexity}
              </span>
            )}
            <Tip label={k.reEstimate}>
              <Button
                aria-label={k.reEstimate}
                className="ml-auto"
                disabled={est.isPending}
                onClick={() => est.mutate()}
                size="icon-xs"
                variant="ghost"
              >
                <Codicon name="refresh" size="0.75rem" spinning={est.isPending} />
              </Button>
            </Tip>
          </div>
          {result.rationale && (
            <p className="text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)">{result.rationale}</p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button disabled={est.isPending} onClick={() => est.mutate()} size="xs" variant="outline">
            <Codicon name={est.isPending ? 'loading' : 'dashboard'} size="0.75rem" spinning={est.isPending} />
            {est.isPending ? k.estimating : k.estimateEffort}
          </Button>
          <Tip label={k.estimateTipLong}>
            <span className="text-[0.625rem] text-(--ui-text-quaternary)">{k.makesModelCall}</span>
          </Tip>
        </div>
      )}
    </Section>
  )
}

type TaskDetailMode = 'dialog' | 'sheet'

export function TaskDetailHeaderControls({
  mode,
  onClose,
  onToggleMode
}: {
  mode: TaskDetailMode
  onClose: () => void
  onToggleMode: () => void
}) {
  const k = useKanban()
  const toggleLabel = mode === 'sheet' ? k.openAsDialog : k.openAsSideSheet

  return (
    <>
      <button
        aria-label={toggleLabel}
        className="grid size-6 place-items-center rounded text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
        onClick={onToggleMode}
        type="button"
      >
        <Codicon name={mode === 'sheet' ? 'layout-centered' : 'layout-sidebar-right'} size="0.9rem" />
      </button>
      <button
        aria-label={k.close}
        className="grid size-6 place-items-center rounded text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
        onClick={onClose}
        type="button"
      >
        <Codicon name="close" size="0.9rem" />
      </button>
    </>
  )
}

export function TaskDrawerShell({
  children,
  mode,
  onClose,
  onPaste
}: {
  children: ReactNode
  mode: TaskDetailMode
  onClose?: () => void
  onPaste: (event: ClipboardEvent<HTMLElement>) => void
}) {
  const body = (
    <div
      className={cn(
        'flex max-h-full flex-col bg-(--ui-bg-elevated)',
        mode === 'sheet'
          ? 'absolute inset-y-0 right-0 z-20 w-[clamp(26rem,38vw,72rem)] min-w-[22rem] max-w-[calc(100vw-2rem)] resize-x overflow-auto border-l border-(--ui-stroke-tertiary) duration-150 ease-out animate-in fade-in slide-in-from-right-4 [direction:rtl]'
          : 'h-[min(86vh,60rem)] w-[min(68rem,94vw)] max-w-none overflow-hidden rounded-xl border border-(--stroke-nous) shadow-nous'
      )}
      data-testid="kanban-task-detail-shell"
      onPaste={onPaste}
    >
      <div className="flex min-h-0 flex-1 flex-col [direction:ltr]">{children}</div>
    </div>
  )

  if (mode === 'dialog') {
    return (
      <Dialog onOpenChange={open => !open && onClose?.()} open>
        <DialogContent bodyClassName="p-0 overflow-visible" className="w-auto max-w-none border-0 bg-transparent p-0 shadow-none" showCloseButton={false}>
          {body}
        </DialogContent>
      </Dialog>
    )
  }

  return body
}

export function TaskDrawer({
  columns,
  id,
  onClose,
  onOpen
}: {
  columns: string[]
  id: null | string
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const [mode, setMode] = useState<TaskDetailMode>('sheet')
  const k = useKanban()
  const qc = useQueryClient()
  const slug = useValue($boardSlug)
  const pasteGuardRef = useRef(new PastedImageUploadGuard())

  // Socket-invalidated (bindApi); the interval is only the socketless heartbeat.
  const { data: detail, error } = useQuery({
    enabled: !!id,
    queryFn: () => fetchTask(id!),
    queryKey: taskKey(slug, id ?? ''),
    refetchInterval: 30_000
  })

  const task = detail?.task
  const running = task?.status === 'running'
  const defaultAssignee = useDefaultAssignee()

  const { data: log } = useQuery({
    enabled: !!id,
    queryFn: () => fetchLog(id!),
    queryKey: logKey(slug, id ?? ''),
    refetchInterval: running ? 3_000 : 15_000
  })

  // Esc closes the drawer even though it isn't modal (no backdrop to click off).
  useEffect(() => {
    if (!id) {
      return
    }

    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [id, onClose])

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: taskKey(slug, id!) })
    void qc.invalidateQueries({ queryKey: ['kanban', 'board', slug] })
  }

  // Optimistic status change against the task cache; rolls back + toasts on a
  // rejected transition (the backend enforces the workflow).
  const moveMut = useMutation({
    mutationFn: (status: string) => patchTask(id!, { status }),
    onMutate: async status => {
      await qc.cancelQueries({ queryKey: taskKey(slug, id!) })
      const previous = qc.getQueryData<KanbanTaskDetail>(taskKey(slug, id!))

      if (previous) {
        qc.setQueryData(taskKey(slug, id!), { ...previous, task: { ...previous.task, status } })
      }

      return { previous }
    },
    onError: (err, _status, context) => {
      if (context?.previous) {
        qc.setQueryData(taskKey(slug, id!), context.previous)
      }

      host.notify({ kind: 'error', message: errText(err) })
    },
    onSettled: invalidate
  })

  const mutate = (fn: () => Promise<unknown>, onDone?: () => void) => () =>
    fn().then(
      () => {
        invalidate()
        onDone?.()
      },
      (err: unknown) => host.notify({ kind: 'error', message: errText(err) })
    )

  const commentMut = useMutation({
    mutationFn: (body: string) => addComment(id!, body),
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSuccess: invalidate
  })

  // "Note & requeue" for a running task: post the note, then reclaim so the
  // dispatcher re-runs it with the note in the worker's context — the one-click
  // replacement for the block → comment → unblock dance.
  const requeueMut = useMutation({
    mutationFn: async (body: string) => {
      await addComment(id!, body)
      await reclaimTask(id!)
    },
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSuccess: () => {
      host.notify({ kind: 'info', message: k.notePosted })
      invalidate()
    }
  })

  const uploadFile = async (file: File): Promise<KanbanAttachment | null> => {
    const res = await uploadAttachment(id!, {
      bytes: await file.arrayBuffer(),
      contentType: file.type || undefined,
      filename: file.name
    })

    return res.attachment ?? null
  }

  const uploadPastedImageFile = async (file: File): Promise<KanbanAttachment | null> => {
    const res = await uploadPastedImage(id!, {
      bytes: await file.arrayBuffer(),
      contentType: file.type || undefined,
      filename: file.name
    })

    return res.attachment ?? null
  }

  const uploadPastedImageFiles = async (files: File[]): Promise<KanbanAttachment[]> => {
    const uploaded: KanbanAttachment[] = []

    for (const file of files) {
      const attachment = await uploadPastedImageFile(file)

      if (attachment) {
        uploaded.push(attachment)
      }
    }

    return uploaded
  }

  const uploadMut = useMutation({
    mutationFn: uploadFile,
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSuccess: invalidate
  })

  const pasteImagesMut = useMutation({
    mutationFn: async ({ body, comment, files }: { body?: string; comment?: boolean; files: File[] }) => {
      if (!pasteGuardRef.current.begin(files)) {
        host.notify({ kind: 'info', message: 'Already uploading pasted image.' })

        return []
      }

      try {
        host.notify({ kind: 'info', message: `Uploading pasted image${files.length === 1 ? '' : 's'}…` })
        const attachments = await uploadPastedImageFiles(files)
        const commentBody = comment ? buildPastedImageComment(body ?? '', attachments) : ''

        if (commentBody) {
          await addComment(id!, commentBody)
        }

        return attachments
      } finally {
        pasteGuardRef.current.finish(files)
      }
    },
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSettled: invalidate
  })

  const pasteImagesAsAttachments = (event: ClipboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || pasteImagesMut.isPending || uploadMut.isPending) {
      return
    }

    const target = event.target as null | HTMLElement
    const tag = target?.tagName.toLowerCase()

    if (tag === 'textarea' || tag === 'input' || target?.isContentEditable) {
      return
    }

    const files = clipboardImageFiles(event.clipboardData)

    if (!files.length) {
      return
    }

    event.preventDefault()
    void pasteImagesMut.mutateAsync({ files })
  }

  if (!id) {
    return null
  }

  const errorMessage = error ? errText(error) : null

  const move = (status: string) => {
    if (!task || status === task.status) {
      return
    }

    if (isLockedTarget(status)) {
      host.notify({ kind: 'info', message: lockedReason(k, status) })

      return
    }

    moveMut.mutate(status)
  }

  return (
    <TaskDrawerShell mode={mode} onClose={onClose} onPaste={pasteImagesAsAttachments}>
      <header className="flex flex-col gap-2 px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          {task ? (
            <StatusMenu columns={columns} onMove={move} status={task.status} />
          ) : (
            <span className="font-mono text-sm text-(--ui-text-tertiary)">{shortId(id)}</span>
          )}
          {task && (
            <span className="font-mono text-[0.625rem] text-(--ui-text-quaternary)" data-selectable-text="true">
              {shortId(task.id)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {task && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={k.taskActions}
                    className="grid size-6 place-items-center rounded text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
                    type="button"
                  >
                    <Codicon name="ellipsis" size="0.9rem" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      void navigator.clipboard.writeText(task.id)
                      host.notify({ kind: 'info', message: k.copiedId(task.id) })
                    }}
                  >
                    <Codicon name="copy" size="0.85rem" />
                    {k.copyTaskId}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      void navigator.clipboard.writeText(task.title || task.id)
                      host.notify({ kind: 'info', message: k.copiedTitle })
                    }}
                  >
                    <Codicon name="copy" size="0.85rem" />
                    {k.copyTitle}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={mutate(() => patchTask(task.id, { status: 'archived' }), onClose)}>
                    <Codicon name="archive" size="0.85rem" />
                    {k.archiveTask}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={mutate(() => deleteTask(task.id), onClose)}>
                    <Codicon name="trash" size="0.85rem" />
                    {k.deleteTask}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <TaskDetailHeaderControls mode={mode} onClose={onClose} onToggleMode={() => setMode(value => (value === 'sheet' ? 'dialog' : 'sheet'))} />
          </div>
        </div>
        {task && (
          <h2 className="text-sm leading-snug font-semibold text-foreground" data-selectable-text="true">
            {task.title || task.id}
          </h2>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" data-selectable-text="true">
        {errorMessage ? (
          <ErrorState title={errorMessage} />
        ) : !detail || !task ? (
          <div className="grid h-32 place-items-center">
            <Loader type="lemniscate-bloom" />
          </div>
        ) : (
          <Tabs className="gap-3 text-sm" defaultValue="details">
            <TabsList className="sticky top-0 z-10 h-8 w-full justify-start overflow-x-auto rounded-none border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) p-0">
              <TabsTrigger className="h-8 rounded-none px-2.5 text-[0.6875rem] data-[state=active]:shadow-none" value="details">
                {k.tabDetails}
              </TabsTrigger>
              <TabsTrigger className="h-8 rounded-none px-2.5 text-[0.6875rem] data-[state=active]:shadow-none" value="activity">
                {k.tabActivity}
              </TabsTrigger>
              <TabsTrigger className="h-8 rounded-none px-2.5 text-[0.6875rem] data-[state=active]:shadow-none" value="discussion">
                {k.tabDiscussion}
              </TabsTrigger>
            </TabsList>

            <DrawerTabContent value="details">
              <Section label={k.details}>
                <DetailMetaGrid
                  onModelChange={next => void mutate(() => patchTask(task.id, overridePatch(next)))()}
                  onReassign={profile => void mutate(() => reassignTask(task.id, profile))()}
                  task={task}
                />
              </Section>

              {task.status === 'ready' && !task.assignee && !defaultAssignee && (
                <Callout title={k.readyUnassignedTitle} tone={SEVERITY_TONE.warning}>
                  <p className="text-[0.71rem] leading-relaxed text-(--ui-text-secondary)">{k.readyUnassignedBody}</p>
                </Callout>
              )}

              {task.diagnostics && task.diagnostics.length > 0 && (
                <Section label={k.diagnosticsN(task.diagnostics.length)}>
                  <Diagnostics items={task.diagnostics} onReclaim={() => void mutate(() => reclaimTask(task.id))()} />
                </Section>
              )}

              <DescriptionSection body={task.body} onSave={body => void mutate(() => patchTask(task.id, { body }))()} />

              <EstimateSection id={task.id} />

              {task.result && (
                <Section label={k.result}>
                  <p className="whitespace-pre-wrap text-[0.8125rem] text-(--ui-text-secondary)">{task.result}</p>
                </Section>
              )}

              {task.latest_summary && !isAdminSummary(task.latest_summary) && (
                <Section label={k.latestSummary}>
                  <p className="whitespace-pre-wrap text-[0.8125rem] text-(--ui-text-secondary)">{task.latest_summary}</p>
                </Section>
              )}

              {(detail.links.parents.length > 0 || detail.links.children.length > 0) && (
                <DependenciesSection detail={detail} onOpen={onOpen} />
              )}
            </DrawerTabContent>

            <DrawerTabContent value="activity">
              <TimelineSection detail={detail} log={log} />

              {detail.events.length > 0 && (
                <Section collapsible label={k.activity(detail.events.length)}>
                  <ScrollFade deps={detail.events.length} max="7rem">
                    <ul className="flex flex-col gap-1">
                      {detail.events.map(event => {
                        const { detail: extra, label } = eventText(event, k)

                        return (
                          <li className="flex items-baseline gap-2 text-[0.6875rem]" key={event.id}>
                            <span className="shrink-0 text-(--ui-text-secondary)">{label}</span>
                            {extra && (
                              <span
                                className="min-w-0 truncate text-[0.625rem] text-(--ui-text-quaternary)"
                                title={extra}
                              >
                                {extra}
                              </span>
                            )}
                            <span className="ml-auto shrink-0 text-(--ui-text-quaternary)">{ago(event.created_at)}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </ScrollFade>
                </Section>
              )}

              {detail.runs.length > 0 && (
                <Section collapsible label={k.runs(detail.runs.length)}>
                  <ScrollFade max="11rem">
                    <ul className="flex flex-col gap-1.5">
                      {detail.runs.map(run => {
                        const failed = ['crashed', 'failed', 'timed_out', 'gave_up'].includes(run.outcome ?? run.status)

                        return (
                          <li className="flex flex-col gap-0.5 text-[0.71rem]" key={run.id}>
                            <div className="flex items-center gap-2">
                              <Badge size="xs" variant={failed ? 'destructive' : 'muted'}>
                                {run.outcome ?? run.status}
                              </Badge>
                              {run.profile && <span className="text-(--ui-text-tertiary)">{run.profile}</span>}
                              {duration(run.started_at, run.ended_at) && (
                                <span className="text-(--ui-text-quaternary)">
                                  {duration(run.started_at, run.ended_at)}
                                </span>
                              )}
                              <span className="ml-auto shrink-0 text-(--ui-text-quaternary)">
                                {ago(run.ended_at ?? run.started_at)}
                              </span>
                            </div>
                            {(run.error || run.summary) && (
                              <p
                                className={cn(
                                  'line-clamp-2 whitespace-pre-wrap',
                                  run.error ? 'text-destructive' : 'text-(--ui-text-quaternary)'
                                )}
                              >
                                {run.error ?? run.summary}
                              </p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </ScrollFade>
                </Section>
              )}

              {log?.exists && log.content && (
                <Section collapsible label={log.truncated ? k.workerLogTail : k.workerLog}>
                  <ScrollFade deps={log.content.length} max="12rem">
                    <LogView className="border-0 px-0">{log.content}</LogView>
                  </ScrollFade>
                </Section>
              )}
            </DrawerTabContent>

            <DrawerTabContent value="discussion">
              <Section
                action={
                  <Tip label={running ? k.commentsHelpRunning : k.commentsHelp}>
                    <span className="grid size-5 place-items-center rounded text-(--ui-text-quaternary) hover:text-(--ui-text-secondary)">
                      <Codicon name="question" size="0.8rem" />
                    </span>
                  </Tip>
                }
                label={k.comments(detail.comments.length)}
              >
                {detail.comments.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {detail.comments.map(comment => (
                      <li className="text-[0.75rem]" key={comment.id}>
                        <span className="font-medium text-(--ui-text-secondary)">{comment.author}</span>
                        <span className="ml-2 text-[0.625rem] text-(--ui-text-quaternary)">
                          {ago(comment.created_at)}
                        </span>
                        <KanbanCommentBody body={comment.body} />
                      </li>
                    ))}
                  </ul>
                )}
                <CommentComposer
                  onPasteImages={files => pasteImagesMut.mutateAsync({ files })}
                  onRequeue={body => requeueMut.mutate(body)}
                  onSubmit={body => commentMut.mutate(body)}
                  pending={commentMut.isPending || pasteImagesMut.isPending || requeueMut.isPending}
                  running={running}
                />
              </Section>

              <AttachmentsSection
                attachments={detail.attachments}
                onPasteImages={files => pasteImagesMut.mutateAsync({ files })}
                onUpload={file => uploadMut.mutate(file)}
                pending={pasteImagesMut.isPending || uploadMut.isPending}
              />
            </DrawerTabContent>
          </Tabs>
        )}
      </div>
    </TaskDrawerShell>
  )
}
