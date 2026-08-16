/**
 * The Kanban board page — mounted at `/kanban` (a ROUTES_AREA contribution) in
 * the workspace pane. The desktop port of the dashboard board: one compact
 * header row (board switcher, filter kebab, search, settings, new task), columns in
 * BOARD_COLUMNS order, drag-to-move (optimistic, workflow-checked),
 * ⌘-click multi-select with a floating bulk bar, right-click actions, and
 * the detail drawer. Dispatch nudges ride every write (see api.ts).
 */

import {
  atom,
  Button,
  cn,
  Codicon,
  compactNumber,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  host,
  Input,
  Loader,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  Tip,
  useGrabScroll,
  useMutation,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { useIsMutating } from '@tanstack/react-query'
import {
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  $boardSlug,
  $collapsedLanes,
  $introDismissed,
  $lanesByProfile,
  $taskSortDirection,
  $taskTimeDisplay,
  boardKey,
  BOARDS_KEY,
  bulkTasks,
  createTask,
  deleteTask,
  estimateNew,
  fetchBoard,
  fetchBoards,
  fetchProfiles,
  patchTask,
  PROFILES_KEY,
  uploadPastedImage
} from './api'
import { BoardSwitcher } from './board-switcher'
import { TaskDrawer } from './drawer'
import { EMPTY_OVERRIDE, ModelOverrideField, overrideCreateFields, type TaskModelOverride } from './model-override'
import { filterNewTaskImageFiles, NEW_TASK_IMAGE_ACCEPT, uploadNewTaskImages } from './new-task-images'
import { OrchestrationPanel } from './orchestration'
import { clipboardImageFiles } from './paste-images'
import {
  columnMeta,
  type KanbanAttachment,
  type KanbanBoard,
  type KanbanTask,
  type TaskEstimate,
  type TaskSortDirection,
  type TaskSortDirections,
  type TaskTimeDisplay
} from './types'
import { isUnreadAttentionCard } from './unread'
import {
  $newTaskLane,
  ago,
  type ArcState,
  arcState,
  Avatar,
  columnHelp,
  columnLabel,
  errText,
  FIELD_LABEL,
  isAiManagedTag,
  isLockedTarget,
  kanbanTagDisplayName,
  lockedReason,
  RunClock,
  shortId,
  useDefaultAssignee,
  useKanban,
  useOrchestration
} from './ui'

export { isAiManagedTag, kanbanTagDisplayName } from './ui'
export { isUnreadAttentionCard } from './unread'
export type { TaskSortDirection, TaskTimeDisplay } from './types'

const fmtTaskDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
export const VISIBLE_BOARD_MUTATION_KEY = ['kanban', 'visible-board-mutation'] as const
export const $visibleBoardBusy = atom(false)

export interface NewTaskDraft {
  assignee: string
  bodyText: string
  goalMode: boolean
  id: string
  images: File[]
  modelOverride: TaskModelOverride
  parent: string
  priority: string
  skills: string
  target: string
  title: string
  workspaceKind: string
  workspacePath: string
}

type NewTaskDraftState = Omit<NewTaskDraft, 'id' | 'target'>

let nextNewTaskDraftId = 1

export function createNewTaskDraft(target: string, patch: Partial<NewTaskDraft> = {}): NewTaskDraft {
  return {
    assignee: '',
    bodyText: '',
    goalMode: false,
    id: `new-task-${Date.now()}-${nextNewTaskDraftId++}`,
    images: [],
    modelOverride: EMPTY_OVERRIDE,
    parent: '',
    priority: '0',
    skills: '',
    target,
    title: '',
    workspaceKind: '',
    workspacePath: '',
    ...patch
  }
}

export function updateNewTaskDraft(draft: NewTaskDraft, patch: Partial<NewTaskDraft>): NewTaskDraft {
  return { ...draft, ...patch }
}

export function minimizedNewTaskDrafts(drafts: readonly NewTaskDraft[]): NewTaskDraft[] {
  return [...drafts]
}

export const draftBarClassName = (hasSelection: boolean): string => (hasSelection ? 'bottom-14' : 'bottom-4')

export const $newTaskDrafts = atom<NewTaskDraft[]>([])
export const $newTaskRestoreDraft = atom<null | NewTaskDraft>(null)
// DialogContent renders its close button as an absolute shell control. Keep the
// draft minimize button on that same control rail instead of flexing it inside
// the title row; otherwise its vertical position follows the title line-height
// while the close button follows the shell inset.
export const NEW_TASK_MINIMIZE_BUTTON_CLASS =
  'absolute right-10 top-2.5 z-20 text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
export const NEW_TASK_MINIMIZE_BUTTON_SIZE = 'icon-xs' as const
export const KANBAN_LANE_WIDTH_CLASS = 'w-[min(22rem,calc(100vw-2rem))] md:w-80 xl:w-[22rem]'
export const KANBAN_BOARD_SCROLL_CLASS =
  'flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 pt-1 pb-3'
export const KANBAN_COLUMN_TASKS_CLASS =
  'relative flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto pr-1'

// ── optimistic board edits (reconciled by the follow-up refresh) ─────────────

function moveCard(board: KanbanBoard, id: string, toStatus: string): KanbanBoard {
  let moved: KanbanTask | undefined

  const columns = board.columns.map(col => ({
    ...col,
    tasks: col.tasks.filter(task => {
      if (task.id !== id) {
        return true
      }

      moved = { ...task, status: toStatus }

      return false
    })
  }))

  if (!moved) {
    return board
  }

  return {
    ...board,
    columns: columns.map(col => (col.name === toStatus ? { ...col, tasks: [moved!, ...col.tasks] } : col))
  }
}

function removeCard(board: KanbanBoard, id: string): KanbanBoard {
  return { ...board, columns: board.columns.map(col => ({ ...col, tasks: col.tasks.filter(t => t.id !== id) })) }
}

export function sortColumnTasks(tasks: readonly KanbanTask[], direction: TaskSortDirection): KanbanTask[] {
  const dir = direction === 'desc' ? -1 : 1

  return [...tasks].sort((a, b) => {
    const time = ((a.created_at ?? 0) - (b.created_at ?? 0)) * dir

    if (time !== 0) {
      return time
    }

    const priority = (b.priority ?? 0) - (a.priority ?? 0)

    if (priority !== 0) {
      return priority
    }

    return a.id.localeCompare(b.id)
  })
}

export function taskSortDirectionForColumn(directions: TaskSortDirections, column: string): TaskSortDirection {
  return directions[column] === 'desc' ? 'desc' : 'asc'
}

export function toggleColumnSortDirection(directions: TaskSortDirections, column: string): TaskSortDirections {
  return { ...directions, [column]: taskSortDirectionForColumn(directions, column) === 'asc' ? 'desc' : 'asc' }
}

export function taskTimeLabel(task: KanbanTask, display: TaskTimeDisplay, nowMs = Date.now()): ReactNode {
  if (!task.created_at) {
    return null
  }

  const ms = task.created_at * 1000
  const relative = ago(task.created_at, nowMs)
  const absolute = fmtTaskDateTime.format(new Date(ms))

  return (
    <span className="text-(--ui-text-quaternary)" title={display === 'relative' ? absolute : (relative ?? absolute)}>
      {display === 'relative' ? relative : absolute}
    </span>
  )
}

export function taskTagsLabel(task: KanbanTask): string {
  return task.tags?.map(tag => tag.name).join(' ') ?? ''
}

// ── card ─────────────────────────────────────────────────────────────────────

function Meta({ children, icon }: { children: ReactNode; icon: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Codicon name={icon} size="0.7rem" />
      {children}
    </span>
  )
}

function CardFooter({
  arc,
  task,
  timeDisplay
}: {
  arc: ArcState | null
  task: KanbanTask
  timeDisplay: TaskTimeDisplay
}) {
  const k = useKanban()
  const created = taskTimeLabel(task, timeDisplay)
  const links = task.link_counts ? task.link_counts.parents + task.link_counts.children : 0
  const fallback = useDefaultAssignee()
  const orchestrator = useOrchestration()?.resolved_orchestrator_profile ?? ''
  // Ready + no assignee: with a configured default assignee the dispatcher
  // auto-assigns on its next tick (#27145) — say THAT, not "won't run". Only
  // a board with no fallback has the genuine silent failure.
  const unassignedReady = task.status === 'ready' && !task.assignee

  // The agent on the hook for a queued card: the explicit assignee, else the
  // auto-default (ready), else the specifier that rewrites triage cards.
  const attached =
    task.assignee ||
    (task.status === 'ready' || task.status === 'todo' ? fallback : task.status === 'triage' ? orchestrator : '')

  const meta = columnMeta(task.status)

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem] text-(--ui-text-tertiary)">
      {arc === 'queued' && attached ? (
        // WHO is coming for the card. The arc only animates once the agent is
        // actually working; while queued, the named chip carries "attached".
        <Tip
          label={
            task.status === 'review'
              ? k.reviewChecking
              : task.assignee
                ? k.attachedTip(attached)
                : task.status === 'triage'
                  ? k.orchestratorTip(attached)
                  : k.autoAssignTip(attached)
          }
        >
          <span className="inline-flex min-w-0 cursor-help items-center gap-1 font-medium" style={{ color: meta.tone }}>
            <Avatar name={attached} size="1.125rem" />
            <span className="truncate">
              {!task.assignee && '→ '}
              {attached}
            </span>
          </span>
        </Tip>
      ) : task.assignee ? (
        <Avatar name={task.assignee} size="1.125rem" />
      ) : null}
      {arc === 'running' && (
        <Tip label={k.arcRunning}>
          <span className="shrink-0 cursor-help">
            <RunClock task={task} />
          </span>
        </Tip>
      )}
      {arc === 'stale' && (
        <Tip label={k.arcStale}>
          <span className="shrink-0 cursor-help font-medium text-amber-500">{k.noHeartbeat}</span>
        </Tip>
      )}
      {unassignedReady && !fallback && (
        <Tip label={k.wontRunTip}>
          <span className="inline-flex shrink-0 cursor-help items-center gap-1 text-amber-500">
            <Codicon name="debug-disconnect" size="0.7rem" />
            {k.wontRun}
          </span>
        </Tip>
      )}
      <div className="ml-auto flex min-w-0 shrink flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {typeof task.priority === 'number' && task.priority > 0 && (
          <span className="inline-flex items-center gap-0.5 text-amber-500">
            <Codicon name="arrow-up" size="0.7rem" />
            {task.priority}
          </span>
        )}
        {task.progress && task.progress.total > 0 && (
          <Meta icon="checklist">
            {task.progress.done}/{task.progress.total}
          </Meta>
        )}
        {Boolean(task.comment_count) && <Meta icon="comment">{task.comment_count}</Meta>}
        {links > 0 && <Meta icon="references">{links}</Meta>}
        {task.warnings && task.warnings.count > 0 && (
          <span className="inline-flex items-center gap-0.5 text-destructive">
            <Codicon name="warning" size="0.7rem" />
            {task.warnings.count}
          </span>
        )}
        {created}
        <span className="min-w-0 truncate font-mono text-(--ui-text-quaternary)">{shortId(task.id)}</span>
      </div>
    </div>
  )
}

function Card({
  columns,
  onDelete,
  onMove,
  onOpen,
  onToggleSelect,
  selected,
  task,
  timeDisplay
}: {
  columns: string[]
  onDelete: (id: string) => void
  onMove: (id: string, status: string) => void
  onOpen: (id: string) => void
  onToggleSelect: (id: string) => void
  selected: boolean
  task: KanbanTask
  timeDisplay: TaskTimeDisplay
}) {
  const k = useKanban()
  const [dragging, setDragging] = useState(false)
  const meta = columnMeta(task.status)
  const summary = task.latest_summary || task.body
  const orchestration = useOrchestration()
  const fallback = (orchestration?.dispatch_default_assignee ?? orchestration?.default_assignee ?? '').trim()
  const showUnread = isUnreadAttentionCard(task)

  const arc = arcState(task, {
    autoDecompose: orchestration?.auto_decompose ?? true,
    fallbackAssignee: fallback,
    reviewDispatch: orchestration?.review_dispatch ?? true
  })

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group relative flex cursor-grab flex-col gap-2 rounded-md border border-(--ui-stroke-tertiary) border-l-2 bg-(--ui-bg-elevated) p-2.5',
            // Hover matches the provider-picker rows: a quiet primary fill;
            // selected = the theme's focus color (same as a focused input).
            'transition-colors hover:bg-primary/[0.06] active:cursor-grabbing',
            selected && 'border-(--dt-composer-ring) bg-[color-mix(in_srgb,var(--dt-composer-ring)_7%,transparent)]',
            dragging && 'opacity-40'
          )}
          draggable
          onClick={event => (event.metaKey || event.ctrlKey ? onToggleSelect(task.id) : onOpen(task.id))}
          onDragEnd={() => setDragging(false)}
          onDragStart={event => {
            event.dataTransfer.setData('text/plain', task.id)
            event.dataTransfer.effectAllowed = 'move'
            // Snapshot the drag image before dimming the source, so the ghost
            // stays a solid card (dimming first would bake 40% into it).
            event.dataTransfer.setDragImage(event.currentTarget, event.nativeEvent.offsetX, event.nativeEvent.offsetY)
            setDragging(true)
          }}
          style={{ '--kanban-tone': meta.tone, borderLeftColor: meta.tone } as CSSProperties}
        >
          {/* Machine-activity arc: claimed work uses the running sweep; queued
              automation-pending cards use a quieter sweep only when the
              dispatcher/decomposer gates say they are actually eligible. Hidden
              during drag/selection so those states stay legible. */}
          {arc && !dragging && !selected && (
            <span
              aria-hidden
              className={cn(
                'kanban-arc',
                arc === 'queued' && 'kanban-arc--queued',
                arc === 'stale' && 'kanban-arc--stale'
              )}
            />
          )}
          {showUnread && (
            <Tip label={k.unreadCard}>
              <span
                aria-label={k.unreadCard}
                className="absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-500 shadow-sm"
                role="status"
              >
                <Codicon name="check" size="0.75rem" />
              </span>
            </Tip>
          )}
          <span
            className={cn(
              'line-clamp-2 text-[0.8125rem] font-medium leading-snug text-foreground',
              showUnread && 'pr-7'
            )}
          >
            {task.title || task.id}
          </span>
          {task.tags && task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map(tag => (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[0.625rem] font-medium',
                    isAiManagedTag(tag)
                      ? 'border-sky-400/40 bg-sky-400/10 text-sky-200'
                      : 'border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary) text-(--ui-text-tertiary)'
                  )}
                  key={tag.normalized_name}
                  title={isAiManagedTag(tag) ? k.aiTagTip : undefined}
                >
                  {kanbanTagDisplayName(tag)}
                  {isAiManagedTag(tag) && (
                    <span className="text-[0.5rem] font-semibold uppercase tracking-[0.08em]">{k.aiTagBadge}</span>
                  )}
                </span>
              ))}
            </div>
          )}
          {summary && (
            <span className="line-clamp-2 text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">{summary}</span>
          )}
          <CardFooter arc={arc} task={task} timeDisplay={timeDisplay} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onOpen(task.id)}>
          <Codicon name="link-external" size="0.85rem" />
          {k.open}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onToggleSelect(task.id)}>
          <Codicon name={selected ? 'close' : 'check-all'} size="0.85rem" />
          {selected ? k.deselect : k.select}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {columns
          .filter(name => name !== task.status && !isLockedTarget(name))
          .map(name => (
            <ContextMenuItem key={name} onSelect={() => onMove(task.id, name)}>
              <span className="size-2 rounded-full" style={{ backgroundColor: columnMeta(name).tone }} />
              {k.moveTo(columnLabel(k, name))}
            </ContextMenuItem>
          ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onDelete(task.id)} variant="destructive">
          <Codicon name="trash" size="0.85rem" />
          {k.delete}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── column ───────────────────────────────────────────────────────────────────

function Column({
  collapsed,
  column,
  columns,
  onAdd,
  onDelete,
  onDropTask,
  onMove,
  onToggleSort,
  onOpen,
  onToggle,
  onToggleSelect,
  selected,
  sortDirections,
  timeDisplay
}: {
  collapsed: boolean
  column: { name: string; tasks: KanbanTask[] }
  columns: string[]
  onAdd: (status: string) => void
  onDelete: (id: string) => void
  onDropTask: (id: string, status: string) => void
  onMove: (id: string, status: string) => void
  onToggleSort: (status: string) => void
  onOpen: (id: string) => void
  onToggle: () => void
  onToggleSelect: (id: string) => void
  selected: ReadonlySet<string>
  sortDirections: TaskSortDirections
  timeDisplay: TaskTimeDisplay
}) {
  const k = useKanban()
  const [over, setOver] = useState(false)
  const meta = columnMeta(column.name)
  const label = columnLabel(k, column.name)
  const locked = isLockedTarget(column.name)
  const byProfile = useValue($lanesByProfile)
  const sortDirection = taskSortDirectionForColumn(sortDirections, column.name)

  const displayTasks = useMemo(() => sortColumnTasks(column.tasks, sortDirection), [column.tasks, sortDirection])

  // The dashboard's "lanes by profile": sub-group Running by assignee so a
  // fleet's in-flight work reads per-worker. Null = flat (off, or trivial).
  const lanes = useMemo(() => {
    if (!byProfile || column.name !== 'running' || displayTasks.length === 0) {
      return null
    }

    const groups = new Map<string, KanbanTask[]>()

    for (const task of displayTasks) {
      const key = task.assignee || UNASSIGNED_LANE
      groups.set(key, [...(groups.get(key) ?? []), task])
    }

    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [byProfile, column.name, displayTasks])

  const dragHandlers = {
    onDragLeave: () => setOver(false),
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      // Locked lanes don't preventDefault → the OS shows the no-drop cursor
      // and the drop event never fires. The lane is honest about itself.
      if (locked) {
        event.dataTransfer.dropEffect = 'none'

        return
      }

      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setOver(true)
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      setOver(false)
      const id = event.dataTransfer.getData('text/plain')

      if (id) {
        onDropTask(id, column.name)
      }
    }
  }

  const wash = over && !locked ? 'bg-(--ui-bg-quinary)' : 'bg-[color-mix(in_srgb,var(--ui-bg-quinary)_50%,transparent)]'

  // Collapsed = a thin vertical rail: dot, sideways label, count. Still a live
  // drop target (drop straight onto the rail); click expands. The dot sits in
  // the same h-5 header row as an expanded lane's, so dots align across the
  // board regardless of collapse state.
  if (collapsed) {
    return (
      <Tip label={columnHelp(k, column.name)} side="right">
        <button
          {...dragHandlers}
          aria-label={k.expand(label)}
          className={cn(
            'flex h-full w-8 shrink-0 flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-(--ui-bg-quinary)',
            wash
          )}
          onClick={onToggle}
          type="button"
        >
          <span className="grid h-5 shrink-0 place-items-center">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.tone }} />
          </span>
          <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary) [writing-mode:vertical-rl]">
            {label}
          </span>
          {column.tasks.length > 0 && (
            <span className="text-[0.625rem] tabular-nums text-(--ui-text-quaternary)">{column.tasks.length}</span>
          )}
        </button>
      </Tip>
    )
  }

  return (
    <div
      {...dragHandlers}
      className={cn(
        'group/col flex h-full min-h-0 shrink-0 flex-col rounded-lg p-2 transition-colors',
        KANBAN_LANE_WIDTH_CLASS,
        wash
      )}
    >
      <header className="mb-1.5 flex h-5 items-center gap-1.5 px-1">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.tone }} />
        <Tip label={columnHelp(k, column.name)}>
          <span
            className="cursor-help rounded-sm text-[0.6875rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary) outline-none focus-visible:ring-1 focus-visible:ring-(--dt-composer-ring)"
            tabIndex={0}
          >
            {label}
          </span>
        </Tip>
        <span className="text-[0.625rem] tabular-nums text-(--ui-text-quaternary)">{column.tasks.length}</span>
        <Tip label={sortDirection === 'asc' ? k.sortColumnOldestFirst(label) : k.sortColumnNewestFirst(label)}>
          <Button
            aria-label={sortDirection === 'asc' ? k.sortColumnOldestFirst(label) : k.sortColumnNewestFirst(label)}
            className="ml-auto"
            onClick={() => onToggleSort(column.name)}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name={sortDirection === 'asc' ? 'arrow-down' : 'arrow-up'} size="0.75rem" />
          </Button>
        </Tip>
        <Tip label={columnHelp(k, column.name)}>
          <button
            aria-label={k.collapse(label)}
            className="grid size-5 place-items-center rounded text-(--ui-text-tertiary) opacity-0 transition-opacity hover:bg-(--chrome-action-hover) hover:text-foreground focus-visible:opacity-100 group-hover/col:opacity-100"
            onClick={onToggle}
            type="button"
          >
            <Codicon name="chevron-left" size="0.75rem" />
          </button>
        </Tip>
      </header>
      <div className={KANBAN_COLUMN_TASKS_CLASS}>
        {lanes
          ? lanes.map(([assignee, tasks]) => (
              <div className="flex flex-col gap-2" key={assignee}>
                <div className="flex items-center gap-1.5 px-1 pt-1 text-[0.625rem] text-(--ui-text-quaternary)">
                  {assignee !== UNASSIGNED_LANE && <Avatar name={assignee} size="0.875rem" />}
                  {assignee}
                  <span className="tabular-nums">{tasks.length}</span>
                </div>
                {tasks.map(task => (
                  <Card
                    columns={columns}
                    key={task.id}
                    onDelete={onDelete}
                    onMove={onMove}
                    onOpen={onOpen}
                    onToggleSelect={onToggleSelect}
                    selected={selected.has(task.id)}
                    task={task}
                    timeDisplay={timeDisplay}
                  />
                ))}
              </div>
            ))
          : displayTasks.map(task => (
              <Card
                columns={columns}
                key={task.id}
                onDelete={onDelete}
                onMove={onMove}
                onOpen={onOpen}
                onToggleSelect={onToggleSelect}
                selected={selected.has(task.id)}
                task={task}
                timeDisplay={timeDisplay}
              />
            ))}
        {/* Jira-style lane add — dashed, faded in on lane hover. Opacity (not
            display) so it always holds its slot and never thrashes layout.
            Locked lanes get none: you can't create into a system state. */}
        {!locked && (
          <button
            aria-label={k.newTaskIn(label)}
            className="flex shrink-0 items-center justify-center rounded-md border border-dashed border-(--ui-stroke-secondary) py-1.5 text-(--ui-text-tertiary) opacity-0 transition-[opacity,color,border-color] group-hover/col:opacity-100 hover:border-(--ui-text-quaternary) hover:bg-(--chrome-action-hover) hover:text-foreground focus-visible:opacity-100"
            onClick={() => onAdd(column.name)}
            type="button"
          >
            <Codicon name="add" size="0.8rem" />
          </button>
        )}
        {column.tasks.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-[0.6875rem] text-(--ui-text-quaternary)">
            {k.empty}
          </div>
        )}
      </div>
    </div>
  )
}

// ── dialogs ──────────────────────────────────────────────────────────────────

const NO_PARENT = '__none__'
const PARKED = '__parked__'
const WORKSPACE_KINDS = ['scratch', 'worktree', 'dir'] as const

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL}>{label}</span>
      {children}
    </label>
  )
}

const draftFromState = (target: string, state: NewTaskDraftState) =>
  createNewTaskDraft(target, { ...state, images: [...state.images] })

function NewTaskDialog({
  onClose,
  parents,
  target
}: {
  onClose: () => void
  parents: Array<{ id: string; title: string }>
  target: null | string
}) {
  const k = useKanban()
  const qc = useQueryClient()
  const { data: roster } = useQuery({ queryKey: PROFILES_KEY, queryFn: fetchProfiles, staleTime: 60_000 })
  // Title-only creates must RUN: "auto" resolves to the orchestration default
  // (ultimately the active profile), applied at create time. Never silently
  // unassigned — parking a card is the explicit choice, not the default.
  const resolvedDefault = useOrchestration()?.resolved_default_assignee || 'default'

  // Board-level workspace default: a task inherits the current board's
  // configured project dir (scratch when unset, worktree in a git repo, else
  // dir) unless the operator overrides it below. Set the board default in the
  // board switcher's "Board settings…".
  const selectedSlug = useValue($boardSlug)
  const { data: boards } = useQuery({ queryKey: BOARDS_KEY, queryFn: fetchBoards, staleTime: 30_000 })
  const currentBoard = boards?.boards.find(b => b.slug === (selectedSlug || boards.current))
  const boardDefaultKind = currentBoard?.default_workspace_kind || 'scratch'
  const boardDefaultDir = currentBoard?.default_workdir || ''

  const isTriage = target === 'triage'
  const [title, setTitle] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('0')
  const [skills, setSkills] = useState('')
  const [workspaceKind, setWorkspaceKind] = useState<string>(boardDefaultKind)
  // Empty = inherit the board's default project dir (backend resolves it);
  // a path here overrides just this task. Only meaningful for dir/worktree.
  const [workspacePath, setWorkspacePath] = useState('')
  const [parent, setParent] = useState('')
  const [modelOverride, setModelOverride] = useState<TaskModelOverride>(EMPTY_OVERRIDE)
  const [goalMode, setGoalMode] = useState(false)
  const [images, setImages] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [estimate, setEstimate] = useState<null | TaskEstimate>(null)
  const restoreDraft = useValue($newTaskRestoreDraft)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [initializedTarget, setInitializedTarget] = useState<null | string>(null)

  const currentDraftState: NewTaskDraftState = {
    assignee,
    bodyText,
    goalMode,
    images,
    modelOverride,
    parent,
    priority,
    skills,
    title,
    workspaceKind,
    workspacePath
  }

  const applyDraft = useCallback(
    (draft: NewTaskDraft) => {
      setTitle(draft.title)
      setBodyText(draft.bodyText)
      setAssignee(draft.assignee)
      setPriority(draft.priority)
      setSkills(draft.skills)
      setWorkspaceKind(draft.workspaceKind || boardDefaultKind)
      setWorkspacePath(draft.workspacePath)
      setParent(draft.parent)
      setModelOverride(draft.modelOverride)
      setGoalMode(draft.goalMode)
      setImages([...draft.images])
      setError(null)
      setBusy(false)
      setEstimate(null)
    },
    [boardDefaultKind]
  )

  // Rough effort estimate from the typed title/body (before the task exists),
  // via the auto-routed auxiliary model. Makes a model call — explicit action.
  const estMut = useMutation({
    mutationFn: () => estimateNew(title.trim(), bodyText.trim()),
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSuccess: r => {
      if (r.ok) {
        setEstimate(r)
      } else {
        host.notify({ kind: 'warning', message: r.reason || k.couldNotEstimate })
      }
    }
  })

  // Reset only once per dialog-open cycle. Board default workspace settings can
  // arrive after the dialog mounts; changing them must not wipe text or images
  // the user already entered before minimizing/restoring the draft.
  useEffect(() => {
    if (!target) {
      if (initializedTarget !== null) {
        setInitializedTarget(null)
      }

      return
    }

    if (initializedTarget === target) {
      return
    }

    setInitializedTarget(target)
    const pendingRestore = restoreDraft && restoreDraft.target === target ? restoreDraft : null

    if (pendingRestore) {
      applyDraft(pendingRestore)
      $newTaskRestoreDraft.set(null)

      return
    }

    setTitle('')
    setBodyText('')
    setAssignee('')
    setPriority('0')
    setSkills('')
    setWorkspaceKind(boardDefaultKind)
    setWorkspacePath('')
    setParent('')
    setModelOverride(EMPTY_OVERRIDE)
    setGoalMode(false)
    setImages([])
    setError(null)
    setBusy(false)
    setEstimate(null)
  }, [target, initializedTarget, restoreDraft, applyDraft, boardDefaultKind])

  const addImages = (files: Iterable<File>) => {
    const next = filterNewTaskImageFiles(files)

    if (!next.length) {
      return
    }

    setImages(current => [...current, ...next])
  }

  const pasteImages = (event: ReactClipboardEvent<HTMLElement>) => {
    const files = clipboardImageFiles(event.clipboardData)

    if (!files.length) {
      return
    }

    event.preventDefault()
    setImages(current => [...current, ...files])
  }

  const uploadNewTaskImage = async (taskId: string, file: File): Promise<KanbanAttachment | null> => {
    const res = await uploadPastedImage(taskId, {
      bytes: await file.arrayBuffer(),
      contentType: file.type || undefined,
      filename: file.name
    })

    return res.attachment ?? null
  }

  const submit = async () => {
    const trimmed = title.trim()

    if (!trimmed || !target || busy) {
      return
    }

    setBusy(true)
    $visibleBoardBusy.set(true)
    setError(null)

    try {
      const skillList = skills
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

      const finalAssignee = assignee === PARKED ? undefined : assignee || resolvedDefault
      // Tasks with images are created parked (triage/ready + unassigned), then images
      // are uploaded before the final assignee/status patch nudges dispatch.
      // Otherwise the create auto-nudge can let a worker claim the task before
      // its pasted/uploaded screenshots are visible in worker context.
      const createAssignee = images.length > 0 ? undefined : finalAssignee

      // create() derives status (triage flag → 'triage', else 'ready'); move to
      // the requested column when they differ, so a per-column add lands right.
      const { task, warning } = await createTask({
        assignee: createAssignee,
        body: bodyText.trim() || undefined,
        goal_mode: goalMode,
        parents: parent ? [parent] : undefined,
        priority: Number(priority) || 0,
        skills: skillList.length ? skillList : undefined,
        title: trimmed,
        triage: isTriage,
        workspace_kind: workspaceKind,
        ...overrideCreateFields(modelOverride),
        // Empty → backend inherits the board's default project dir.
        workspace_path: workspaceKind !== 'scratch' && workspacePath.trim() ? workspacePath.trim() : undefined
      })

      if (task && images.length > 0) {
        await uploadNewTaskImages(task.id, images, uploadNewTaskImage)
      }

      if (task && (task.status !== target || (images.length > 0 && finalAssignee))) {
        await patchTask(task.id, { ...(finalAssignee ? { assignee: finalAssignee } : {}), status: target })
      }

      // Dispatcher-presence warning ("this ready task will sit idle") — not an
      // error, but the user should know.
      if (warning) {
        host.notify({ kind: 'warning', message: warning })
      }

      await qc.invalidateQueries({ queryKey: ['kanban', 'board'] })
      onClose()
    } catch (err) {
      setError(errText(err))
      setBusy(false)
    } finally {
      $visibleBoardBusy.set(false)
    }
  }

  const minimizeDraft = () => {
    if (!target || busy) {
      return
    }

    const draft = draftFromState(target, currentDraftState)
    $newTaskDrafts.set([...$newTaskDrafts.get(), draft])
    onClose()
  }

  return (
    <Dialog onOpenChange={open => !open && onClose()} open={Boolean(target)}>
      {/* `overflow-visible`: DialogContent publishes ITSELF as the portal
          container for popovers opened inside it (dialog-portal-context), and
          its default `overflow-y-auto` then crops them at the dialog's edge —
          the model menu below is born inside that scroll box. This dialog
          already owns a scroller on its body div, so the shell's clip is
          redundant here and dropping it is safe. The general fix to
          DialogContent is in flight as #75600; when that lands this override
          becomes a no-op and can go. */}
      <DialogContent className="w-[min(42rem,94vw)] max-w-none overflow-visible">
        <DialogHeader className="flex-row items-center gap-2 text-left">
          <DialogTitle>{target ? k.newTaskIn(columnLabel(k, target)) : k.newTask}</DialogTitle>
          <Button
            aria-label={k.minimizeDraft}
            className={NEW_TASK_MINIMIZE_BUTTON_CLASS}
            disabled={busy}
            onClick={minimizeDraft}
            size={NEW_TASK_MINIMIZE_BUTTON_SIZE}
            title={k.minimizeDraft}
            variant="ghost"
          >
            <Codicon name="chrome-minimize" size="0.75rem" />
          </Button>
        </DialogHeader>
        <div className="flex max-h-[min(72vh,44rem)] flex-col gap-3 overflow-y-auto pr-0.5" onPaste={pasteImages}>
          <Input
            autoFocus
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder={isTriage ? k.titlePlaceholderTriage : k.titlePlaceholder}
            value={title}
          />
          <Textarea
            className="min-h-20"
            onChange={event => setBodyText(event.target.value)}
            placeholder={k.descPlaceholder}
            value={bodyText}
          />

          <Field label={k.attachments(images.length)}>
            <input
              accept={NEW_TASK_IMAGE_ACCEPT}
              hidden
              multiple
              onChange={event => {
                addImages(event.target.files ?? [])
                event.target.value = ''
              }}
              ref={imageInputRef}
              type="file"
            />
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary) p-2">
              {images.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {images.map((file, index) => (
                    <li
                      className="group relative overflow-hidden rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated)"
                      key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    >
                      <img
                        alt={file.name || `Image ${index + 1}`}
                        className="h-16 w-16 object-cover"
                        src={URL.createObjectURL(file)}
                      />
                      <button
                        aria-label={`Remove ${file.name || `image ${index + 1}`} from task images`}
                        className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded bg-black/65 text-white opacity-90 transition-opacity group-hover:opacity-100"
                        onClick={() => setImages(current => current.filter((_, i) => i !== index))}
                        type="button"
                      >
                        <Codicon name="close" size="0.65rem" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[0.6875rem] text-(--ui-text-quaternary)">{k.noAttachments}</span>
              )}
              <Button
                className="self-start"
                disabled={busy}
                onClick={() => imageInputRef.current?.click()}
                size="xs"
                variant="outline"
              >
                <Codicon name="cloud-upload" size="0.75rem" />
                {k.uploadAttachment}
              </Button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={k.priority}>
              <Input onChange={event => setPriority(event.target.value)} type="number" value={priority} />
            </Field>
            <Field label={k.workspace}>
              <Select onValueChange={setWorkspaceKind} value={workspaceKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKSPACE_KINDS.map(kind => (
                    <SelectItem key={kind} value={kind}>
                      {kind}
                      {kind === boardDefaultKind ? k.boardDefaultSuffix : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {workspaceKind !== 'scratch' && (
            <Field label={k.workspaceOverride}>
              <Input
                onChange={event => setWorkspacePath(event.target.value)}
                placeholder={boardDefaultDir || k.workspaceInherit}
                value={workspacePath}
              />
              <span className="text-[0.625rem] text-(--ui-text-quaternary)">
                {boardDefaultDir ? k.workspaceInheritDir(boardDefaultDir) : k.workspaceInheritGeneric}
              </span>
            </Field>
          )}

          <Field label={k.assignee}>
            <Select onValueChange={v => setAssignee(v === NO_PARENT ? '' : v)} value={assignee || NO_PARENT}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>{k.defaultOption(resolvedDefault)}</SelectItem>
                {(roster?.profiles ?? [])
                  .filter(profile => profile.name !== resolvedDefault)
                  .map(profile => (
                    <SelectItem key={profile.name} value={profile.name}>
                      {profile.name}
                    </SelectItem>
                  ))}
                <SelectItem value={PARKED}>{k.parkedOption}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label={k.skills}>
            <Input onChange={event => setSkills(event.target.value)} placeholder={k.skillsPlaceholder} value={skills} />
          </Field>

          <Field label={k.model}>
            <ModelOverrideField onChange={setModelOverride} value={modelOverride} />
            <span className="text-[0.625rem] text-(--ui-text-quaternary)">{k.modelHint}</span>
          </Field>

          {parents.length > 0 && (
            <Field label={k.parent}>
              <Select onValueChange={v => setParent(v === NO_PARENT ? '' : v)} value={parent || NO_PARENT}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>{k.noParent}</SelectItem>
                  {parents.map(option => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.title || option.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-[0.75rem] text-(--ui-text-secondary)">
            <Switch aria-label={k.goalMode} checked={goalMode} onCheckedChange={setGoalMode} size="xs" />
            {k.goalMode}
          </label>

          {error && <span className="text-[0.75rem] text-destructive">{error}</span>}
        </div>
        <DialogFooter>
          <div className="mr-auto flex items-center gap-1 text-[0.75rem] text-(--ui-text-tertiary)">
            {estimate?.ok ? (
              <>
                <Tip label={estimate.rationale || k.roughEstimate}>
                  <span className="font-medium tabular-nums text-(--ui-text-secondary)">
                    ~{compactNumber(estimate.est_tokens)} {k.tokUnit}
                    {estimate.complexity ? ` · ${k.complexity[estimate.complexity] ?? estimate.complexity}` : ''}
                  </span>
                </Tip>
                <Tip label={k.reEstimate}>
                  <Button
                    aria-label={k.reEstimate}
                    disabled={!title.trim() || estMut.isPending}
                    onClick={() => estMut.mutate()}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Codicon name="refresh" size="0.7rem" spinning={estMut.isPending} />
                  </Button>
                </Tip>
              </>
            ) : (
              <Tip label={k.estimateTip}>
                <Button
                  disabled={!title.trim() || estMut.isPending}
                  onClick={() => estMut.mutate()}
                  size="xs"
                  variant="ghost"
                >
                  <Codicon
                    name={estMut.isPending ? 'loading' : 'dashboard'}
                    size="0.75rem"
                    spinning={estMut.isPending}
                  />
                  {estMut.isPending ? k.estimating : k.estimate}
                </Button>
              </Tip>
            )}
          </div>
          <Button onClick={onClose} variant="text">
            {k.cancel}
          </Button>
          <Button disabled={!title.trim() || busy} onClick={() => void submit()}>
            {busy ? k.creating : k.createTask}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── intro ────────────────────────────────────────────────────────────────────

// One-time explainer for the board's core gotcha: this is a dispatcher queue,
// not a todo list. Dismissal persists via plugin storage.
function Intro() {
  const k = useKanban()
  const dismissed = useValue($introDismissed)

  if (dismissed) {
    return null
  }

  return (
    <div
      className="mx-4 mb-2 flex flex-col items-start gap-1.5 rounded-lg bg-(--ui-bg-quinary) px-3 py-2.5 text-[0.75rem] leading-relaxed text-(--ui-text-secondary)"
      data-selectable-text="true"
    >
      <p className="min-w-0">{k.introBody}</p>
      <Button onClick={() => $introDismissed.set(true)} size="inline" variant="textStrong">
        {k.introGotIt}
      </Button>
    </div>
  )
}

const UNASSIGNED_LANE = 'unassigned'

// ── filter kebab ─────────────────────────────────────────────────────────────

function FilterMenu({
  archived,
  assignee,
  board,
  onArchived,
  onAssignee,
  onTenant,
  tenant
}: {
  archived: boolean
  assignee: string
  board: KanbanBoard
  onArchived: (v: boolean) => void
  onAssignee: (v: string) => void
  onTenant: (v: string) => void
  tenant: string
}) {
  const k = useKanban()
  const active = Boolean(assignee || tenant || archived)
  const lanesByProfile = useValue($lanesByProfile)

  const check = (on: boolean) => (on ? <Codicon className="ml-auto" name="check" size="0.8rem" /> : null)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={k.filters}
          className={cn(active && 'bg-(--ui-control-active-background) text-foreground')}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="filter" size="0.85rem" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onAssignee('')}>
          {k.allProfiles}
          {check(!assignee)}
        </DropdownMenuItem>
        {board.assignees.map(name => (
          <DropdownMenuItem key={name} onSelect={() => onAssignee(name)}>
            <Avatar name={name} size="0.875rem" />
            {name}
            {check(assignee === name)}
          </DropdownMenuItem>
        ))}
        {board.tenants.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onTenant('')}>
              {k.allTenants}
              {check(!tenant)}
            </DropdownMenuItem>
            {board.tenants.map(name => (
              <DropdownMenuItem key={name} onSelect={() => onTenant(name)}>
                {name}
                {check(tenant === name)}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onArchived(!archived)}>
          {k.showArchived}
          {check(archived)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => $lanesByProfile.set(!lanesByProfile)}>
          {k.groupRunning}
          {check(lanesByProfile)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── selection bar ────────────────────────────────────────────────────────────

/**
 * Floating bulk-actions bar, shown while cards are ⌘-selected. Deliberately
 * leaner than the dashboard's always-on toolbar: move / assign / archive /
 * delete cover the real fleet chores (requeue a batch, archive a sweep of
 * done, reassign after a profile change) via POST /tasks/bulk, which applies
 * per-id and reports partial failures — failed cards stay selected.
 */
function SelectionBar({
  columns,
  onClear,
  onDone,
  selected
}: {
  columns: string[]
  onClear: () => void
  onDone: (failed: string[]) => void
  selected: ReadonlySet<string>
}) {
  const k = useKanban()
  const qc = useQueryClient()
  const { data: roster } = useQuery({ queryKey: PROFILES_KEY, queryFn: fetchProfiles, staleTime: 60_000 })

  const finish = (failed: Array<{ error?: string; id: string }>) => {
    void qc.invalidateQueries({ queryKey: ['kanban', 'board'] })

    if (failed.length > 0) {
      host.notify({
        kind: 'warning',
        message: k.bulkFailed(failed.length, selected.size, failed[0].error ?? k.refused)
      })
    }

    onDone(failed.map(f => f.id))
  }

  const bulk = useMutation({
    mutationKey: VISIBLE_BOARD_MUTATION_KEY,
    mutationFn: (patch: Record<string, unknown>) => bulkTasks([...selected], patch),
    onError: err => host.notify({ kind: 'error', message: errText(err) }),
    onSuccess: data => finish(data.results.filter(r => !r.ok))
  })

  // No bulk-delete on the backend — fan out per id, same partial-failure story.
  const bulkDelete = useMutation({
    mutationKey: VISIBLE_BOARD_MUTATION_KEY,
    mutationFn: async () => {
      const ids = [...selected]
      const settled = await Promise.allSettled(ids.map(id => deleteTask(id)))

      return ids.flatMap((id, i) => {
        const result = settled[i]

        return result.status === 'rejected' ? [{ error: errText(result.reason), id }] : []
      })
    },
    onSuccess: finish
  })

  const busy = bulk.isPending || bulkDelete.isPending
  // One menu at a time — controlled, so a click on the second trigger can
  // never race Radix's dismiss layer into two open menus.
  const [menu, setMenu] = useState<'assign' | 'move' | null>(null)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
      {/* Flat overlay: stroke + elevated surface do the separating, no shadow. */}
      <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) py-1 pr-1 pl-3">
        <span className="mr-1 text-xs tabular-nums text-(--ui-text-secondary)">{k.nSelected(selected.size)}</span>

        <DropdownMenu onOpenChange={open => setMenu(open ? 'move' : null)} open={menu === 'move'}>
          <DropdownMenuTrigger asChild>
            <Button disabled={busy} size="xs" variant="ghost">
              {k.moveToShort}
              <Codicon name="chevron-down" size="0.7rem" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {columns
              .filter(name => !isLockedTarget(name))
              .map(name => (
                <DropdownMenuItem key={name} onSelect={() => bulk.mutate({ status: name })}>
                  <span className="size-2 rounded-full" style={{ backgroundColor: columnMeta(name).tone }} />
                  {columnLabel(k, name)}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu onOpenChange={open => setMenu(open ? 'assign' : null)} open={menu === 'assign'}>
          <DropdownMenuTrigger asChild>
            <Button disabled={busy} size="xs" variant="ghost">
              {k.assign}
              <Codicon name="chevron-down" size="0.7rem" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {(roster?.profiles ?? []).map(profile => (
              <DropdownMenuItem
                key={profile.name}
                onSelect={() => bulk.mutate({ assignee: profile.name, reclaim_first: true })}
              >
                <Avatar name={profile.name} size="0.875rem" />
                {profile.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => bulk.mutate({ assignee: '', reclaim_first: true })}>
              {k.unassignAction}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button disabled={busy} onClick={() => bulk.mutate({ archive: true })} size="xs" variant="ghost">
          {k.archive}
        </Button>
        <Button
          className="text-destructive"
          disabled={busy}
          onClick={() => bulkDelete.mutate()}
          size="xs"
          variant="ghost"
        >
          {k.delete}
        </Button>

        <Tip label={k.clearSelection}>
          <Button aria-label={k.clearSelection} onClick={onClear} size="icon-xs" variant="ghost">
            <Codicon name="close" size="0.8rem" />
          </Button>
        </Tip>
      </div>
    </div>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export function KanbanBoardPage() {
  const k = useKanban()
  const qc = useQueryClient()
  const slug = useValue($boardSlug)
  const visibleBoardBusy = useValue($visibleBoardBusy)
  const [archived, setArchived] = useState(false)
  const sortDirections = useValue($taskSortDirection)
  const timeDisplay = useValue($taskTimeDisplay)

  // Live updates ride the events socket (bindApi); this interval is only the
  // slow heartbeat for socketless paths (OAuth remotes, dropped connections).
  const {
    data: board,
    error,
    isLoading: boardInitialLoading
  } = useQuery({
    queryFn: () => fetchBoard(archived),
    queryKey: boardKey(slug, archived),
    refetchInterval: 60_000
  })

  const visibleMutations = useIsMutating({ mutationKey: VISIBLE_BOARD_MUTATION_KEY })

  const [openId, setOpenId] = useState<null | string>(null)
  const [addStatus, setAddStatus] = useState<null | string>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [tenant, setTenant] = useState('')
  const [assignee, setAssignee] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const drafts = useValue($newTaskDrafts)

  // A new-task request raised from outside the page (⌘⌥N, the palette row).
  // The command navigates here and parks the lane; the page picks it up on
  // arrival — whether it was already mounted or is mounting for the first
  // time — then clears it so a later remount can't reopen the dialog.
  const requestedLane = useValue($newTaskLane)

  useEffect(() => {
    if (requestedLane === null) {
      return
    }

    setAddStatus(requestedLane)
    $newTaskLane.set(null)
  }, [requestedLane])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)

      if (!next.delete(id)) {
        next.add(id)
      }

      return next
    })
  }

  // Prune ids that left the board (completed elsewhere, deleted, filtered by
  // a board switch) so the bar's count never lies about what a bulk op hits.
  useEffect(() => {
    if (!board) {
      return
    }

    const alive = new Set(board.columns.flatMap(col => col.tasks.map(task => task.id)))

    setSelected(prev => {
      const kept = [...prev].filter(id => alive.has(id))

      return kept.length === prev.size ? prev : new Set(kept)
    })
  }, [board])

  useEffect(() => {
    if (selected.size === 0) {
      return
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(new Set())
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [selected.size])

  const columnNames = board?.columns.map(col => col.name) ?? []

  const parentOptions = useMemo(
    () => board?.columns.flatMap(col => col.tasks).map(task => ({ id: task.id, title: task.title })) ?? [],
    [board]
  )

  // Client-side filters, mirroring the dashboard (search over title/body/id).
  const filtered = useMemo(() => {
    if (!board) {
      return null
    }

    const q = search.trim().toLowerCase()

    const keep = (task: KanbanTask) =>
      (!q || `${task.title} ${task.body ?? ''} ${task.id} ${taskTagsLabel(task)}`.toLowerCase().includes(q)) &&
      (!tenant || task.tenant === tenant) &&
      (!assignee || task.assignee === assignee)

    return { ...board, columns: board.columns.map(col => ({ ...col, tasks: col.tasks.filter(keep) })) }
  }, [board, search, tenant, assignee])

  const total = filtered?.columns.reduce((sum, col) => sum + col.tasks.length, 0) ?? 0
  const boardLoading = boardInitialLoading || visibleMutations > 0 || visibleBoardBusy

  const moveMut = useMutation({
    mutationKey: VISIBLE_BOARD_MUTATION_KEY,
    mutationFn: ({ id, status }: { id: string; status: string }) => patchTask(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: boardKey(slug, archived) })
      const previous = qc.getQueryData<KanbanBoard>(boardKey(slug, archived))

      if (previous) {
        qc.setQueryData(boardKey(slug, archived), moveCard(previous, id, status))
      }

      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(boardKey(slug, archived), context.previous)
      }

      host.notify({ kind: 'error', message: errText(err) })
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ['kanban', 'board'] })
      void qc.invalidateQueries({ queryKey: ['kanban', 'task', slug, vars.id] })
    }
  })

  const deleteMut = useMutation({
    mutationKey: VISIBLE_BOARD_MUTATION_KEY,
    mutationFn: (id: string) => deleteTask(id),
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: boardKey(slug, archived) })
      const previous = qc.getQueryData<KanbanBoard>(boardKey(slug, archived))

      if (previous) {
        qc.setQueryData(boardKey(slug, archived), removeCard(previous, id))
      }

      return { previous }
    },
    onError: (err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(boardKey(slug, archived), context.previous)
      }

      host.notify({ kind: 'error', message: errText(err) })
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['kanban', 'board'] })
  })

  const onMove = (id: string, status: string) => {
    const task = board?.columns.flatMap(col => col.tasks).find(candidate => candidate.id === id)

    if (!task || task.status === status) {
      return
    }

    if (isLockedTarget(status)) {
      host.notify({ kind: 'info', message: lockedReason(k, status) })

      return
    }

    moveMut.mutate({ id, status })
  }

  const errorMessage = error ? errText(error) : null

  // Grab-to-scrub the lane strip (shared primitive, same as the dashboard's pan).
  const lanesRef = useRef<HTMLDivElement>(null)
  const { grabbing, onMouseDown } = useGrabScroll(lanesRef)

  // Lane collapse: auto (empty → rail) unless the user overrode it. The map
  // stores only deviations from auto, so it stays tiny and self-heals. On a
  // board with no work at all, auto is disabled — a wall of rails teaches
  // nothing, so a fresh board shows its full structure instead.
  const laneOverrides = useValue($collapsedLanes)
  const boardHasWork = (board?.columns.reduce((sum, col) => sum + col.tasks.length, 0) ?? 0) > 0

  // An override only lives for the lane's current empty/non-empty phase: when
  // emptiness flips (last card dragged out, first card dropped in) the stale
  // override is dropped and auto takes over — so a drained lane collapses even
  // if it was manually expanded ages ago, while expanding an empty lane still
  // sticks for as long as it stays empty.
  //
  // The phase is a string signature held in state, not a ref: React bails out
  // when it's unchanged, so the common case (a poll where no lane's emptiness
  // moved) costs no extra render, and nothing lags a render behind the value
  // it mirrors.
  const lanePhase = filtered
    ? filtered.columns.map(col => `${col.name}:${col.tasks.length === 0 ? 'empty' : 'full'}`).join('|')
    : null

  const [prevLanePhase, setPrevLanePhase] = useState<null | string>(null)

  useEffect(() => {
    if (lanePhase === null || lanePhase === prevLanePhase) {
      return
    }

    setPrevLanePhase(lanePhase)

    if (prevLanePhase === null) {
      return
    }

    const before = new Map(prevLanePhase.split('|').map(entry => entry.split(':') as [string, string]))
    const overrides = { ...$collapsedLanes.get() }
    let changed = false

    for (const entry of lanePhase.split('|')) {
      const [name, phase] = entry.split(':')
      const was = before.get(name)

      if (was !== undefined && was !== phase && name in overrides) {
        delete overrides[name]
        changed = true
      }
    }

    if (changed) {
      $collapsedLanes.set(overrides)
    }
  }, [lanePhase, prevLanePhase])

  const toggleLane = (name: string, auto: boolean) => {
    const overrides = { ...laneOverrides }
    const next = !(overrides[name] ?? auto)

    if (next === auto) {
      delete overrides[name]
    } else {
      overrides[name] = next
    }

    $collapsedLanes.set(overrides)
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-(--ui-surface-background)">
      <header className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2">
        <BoardSwitcher />
        {boardLoading && (
          <span
            aria-label={k.loadingBoard}
            className="inline-flex size-5 items-center justify-center text-(--ui-accent)"
            role="status"
            title={k.loadingBoard}
          >
            <Codicon name="loading" size="0.75rem" spinning />
          </span>
        )}
        {board && (
          <FilterMenu
            archived={archived}
            assignee={assignee}
            board={board}
            onArchived={setArchived}
            onAssignee={setAssignee}
            onTenant={setTenant}
            tenant={tenant}
          />
        )}
        <SearchField aria-label={k.filterCards} onChange={setSearch} placeholder={k.filterCards} value={search} />
        <div className="flex items-center gap-0.5 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) p-0.5">
          <Tip label={timeDisplay === 'relative' ? k.timeAgo : k.datetime}>
            <Button
              aria-label={timeDisplay === 'relative' ? k.timeAgo : k.datetime}
              onClick={() => $taskTimeDisplay.set(timeDisplay === 'relative' ? 'datetime' : 'relative')}
              size="xs"
              variant="ghost"
            >
              {timeDisplay === 'relative' ? k.timeAgoShort : k.datetimeShort}
            </Button>
          </Tip>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Tip label={k.orchestrationSettings}>
            <Button
              aria-label={k.orchestrationSettings}
              className={cn(settingsOpen && 'bg-(--ui-control-active-background) text-foreground')}
              onClick={() => setSettingsOpen(!settingsOpen)}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="organization" size="0.85rem" />
            </Button>
          </Tip>
          <Button onClick={() => setAddStatus('triage')} size="sm">
            <Codicon name="add" size="0.8rem" />
            {k.newTask}
          </Button>
        </div>
      </header>

      {settingsOpen && <OrchestrationPanel />}

      {board && <Intro />}

      {errorMessage && !board ? (
        <div className="grid flex-1 place-items-center">
          <ErrorState title={errorMessage} />
        </div>
      ) : boardInitialLoading && !filtered ? (
        <div className="grid flex-1 place-items-center">
          <Loader type="lemniscate-bloom" />
        </div>
      ) : !filtered ? (
        <div className="grid flex-1 place-items-center px-4 text-center">
          <p className="text-xs text-(--ui-text-tertiary)">{errorMessage ?? k.noTasks}</p>
        </div>
      ) : total === 0 ? (
        <div className="grid flex-1 place-items-center px-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <Codicon className="text-(--ui-text-quaternary)" name="project" size="1.25rem" />
            <p className="text-xs text-(--ui-text-tertiary)">{search || tenant || assignee ? k.noMatch : k.noTasks}</p>
            <Button className="mt-0.5" onClick={() => setAddStatus('triage')} size="sm" variant="outline">
              <Codicon name="add" size="0.75rem" />
              {k.newTask}
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={cn(KANBAN_BOARD_SCROLL_CLASS, grabbing && 'cursor-grabbing')}
          onMouseDown={onMouseDown}
          ref={lanesRef}
        >
          {filtered.columns.map(col => {
            const auto = boardHasWork && col.tasks.length === 0

            return (
              <Column
                collapsed={laneOverrides[col.name] ?? auto}
                column={col}
                columns={columnNames}
                key={col.name}
                onAdd={setAddStatus}
                onDelete={id => deleteMut.mutate(id)}
                onDropTask={onMove}
                onMove={onMove}
                onOpen={setOpenId}
                onToggle={() => toggleLane(col.name, auto)}
                onToggleSelect={toggleSelect}
                onToggleSort={status =>
                  $taskSortDirection.set(toggleColumnSortDirection($taskSortDirection.get(), status))
                }
                selected={selected}
                sortDirections={sortDirections}
                timeDisplay={timeDisplay}
              />
            )
          })}
        </div>
      )}

      {selected.size > 0 && (
        <SelectionBar
          columns={columnNames}
          onClear={() => setSelected(new Set())}
          onDone={failed => setSelected(new Set(failed))}
          selected={selected}
        />
      )}

      {drafts.length > 0 && (
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4',
            draftBarClassName(selected.size > 0)
          )}
        >
          <div className="pointer-events-auto flex max-w-[min(42rem,calc(100%-2rem))] items-center gap-1 overflow-x-auto rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) py-1 pr-1 pl-3">
            <span className="mr-1 shrink-0 text-xs tabular-nums text-(--ui-text-secondary)">
              {k.minimizedDrafts(drafts.length)}
            </span>
            {minimizedNewTaskDrafts(drafts).map(draft => {
              const label = draft.title.trim() || draft.bodyText.trim().slice(0, 28) || k.untitledDraft

              return (
                <Button
                  key={draft.id}
                  onClick={() => {
                    $newTaskDrafts.set($newTaskDrafts.get().filter(item => item.id !== draft.id))
                    $newTaskRestoreDraft.set(draft)
                    setAddStatus(draft.target)
                  }}
                  size="xs"
                  title={k.restoreDraft(label)}
                  variant="ghost"
                >
                  <Codicon name="window" size="0.75rem" />
                  <span className="max-w-36 truncate">{label}</span>
                </Button>
              )
            })}
          </div>
        </div>
      )}

      <NewTaskDialog onClose={() => setAddStatus(null)} parents={parentOptions} target={addStatus} />
      <TaskDrawer columns={columnNames} id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />
    </div>
  )
}
