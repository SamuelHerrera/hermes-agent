import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { $boardSlug, fetchBoard } from './api'
import {
  createNewTaskDraft,
  draftBarClassName,
  isAiManagedTag,
  KANBAN_BOARD_SCROLL_CLASS,
  KANBAN_COLUMN_TASKS_CLASS,
  KANBAN_LANE_WIDTH_CLASS,
  KanbanBoardPage,
  minimizedNewTaskDrafts,
  NEW_TASK_MINIMIZE_BUTTON_CLASS,
  NEW_TASK_MINIMIZE_BUTTON_SIZE,
  sortColumnTasks,
  type TaskSortDirection,
  taskSortDirectionForColumn,
  taskTagsLabel,
  taskTimeLabel,
  toggleColumnSortDirection,
  updateNewTaskDraft
} from './board'
import type { KanbanBoard, KanbanTask } from './types'
import { arcState } from './ui'

const testKanbanText = {
  allProfiles: 'All profiles',
  allTenants: 'All tenants',
  archive: 'Archive',
  assign: 'Assign',
  attachments: (count: number) => `Attachments (${count})`,
  autoAssignTip: (assignee: string) => `Auto-assign to ${assignee}`,
  boardDefaultSuffix: ' (board default)',
  cancel: 'Cancel',
  clearSelection: 'Clear selection',
  col: {
    blocked: { help: 'Blocked cards need human input.', label: 'Blocked' },
    done: { help: 'Completed cards.', label: 'Done' },
    ready: { help: 'Ready cards are waiting for dispatch.', label: 'Ready' },
    review: { help: 'Cards waiting for review.', label: 'Review' },
    running: { help: 'Cards currently running.', label: 'Running' },
    scheduled: { help: 'Cards waiting for their scheduled time.', label: 'Scheduled' },
    todo: { help: 'Cards waiting on dependencies or routing.', label: 'Todo' },
    triage: { help: 'Triage cards need a clearer spec.', label: 'Triage' }
  },
  collapse: (label: string) => `Collapse ${label}`,
  createTask: 'Create task',
  creating: 'Creating…',
  datetime: 'Date/time',
  datetimeShort: 'Date/time',
  defaultOption: (assignee: string) => `Default (${assignee})`,
  delete: 'Delete',
  descPlaceholder: 'Description',
  empty: 'Empty',
  estimate: 'Estimate',
  estimateTip: 'Estimate effort',
  estimating: 'Estimating…',
  expand: (label: string) => `Expand ${label}`,
  filterCards: 'Filter cards',
  filters: 'Filters',
  goalMode: 'Goal mode',
  groupRunning: 'Group running',
  introBody: 'Intro',
  introGotIt: 'Got it',
  minimizedDrafts: (count: number) => `Minimized drafts (${count})`,
  model: 'Model',
  modelHint: 'Optional model override',
  minimizeDraft: 'Minimize draft',
  moveTo: (label: string) => `Move to ${label}`,
  moveToShort: 'Move to',
  nSelected: (count: number) => `${count} selected`,
  newTask: 'New task',
  newTaskIn: (label: string) => `New task in ${label}`,
  noAttachments: 'No attachments',
  noMatch: 'No matching tasks',
  noParent: 'No parent',
  noTasks: 'No tasks',
  loadingBoard: 'Loading board…',
  orchestrationSettings: 'Orchestration settings',
  orchestratorTip: (assignee: string) => `Orchestrator ${assignee}`,
  aiTagBadge: 'AI',
  aiTagTip: 'Managed automatically by AI workflow updates; you can still remove it manually.',
  parent: 'Parent',
  parkedOption: 'Parked',
  priority: 'Priority',
  readyUnassignedTitle: 'Ready but unassigned',
  restoreDraft: (label: string) => `Restore ${label}`,
  roughEstimate: 'Rough estimate',
  skills: 'Skills',
  skillsPlaceholder: 'skills',
  sortColumnNewestFirst: (label: string) => `Sort ${label} newest first`,
  sortColumnOldestFirst: (label: string) => `Sort ${label} oldest first`,
  timeAgo: 'Time ago',
  timeAgoShort: 'Ago',
  title: 'Kanban',
  titlePlaceholder: 'Title',
  titlePlaceholderTriage: 'What needs doing?',
  tokUnit: 'tok',
  unassignAction: 'Unassign',
  untitledDraft: 'Untitled draft',
  uploadAttachment: 'Upload attachment',
  workspace: 'Workspace',
  workspaceInherit: 'Inherit board default',
  workspaceInheritDir: (dir: string) => `Inherits ${dir}`,
  workspaceInheritGeneric: 'Inherits board default',
  workspaceOverride: 'Workspace override'
}

vi.mock('./ui', async () => {
  const actual = await vi.importActual('./ui')

  return {
    ...actual,
    useDefaultAssignee: () => 'default',
    useKanban: () => testKanbanText,
    useOrchestration: () => ({
      auto_decompose: true,
      default_assignee: 'default',
      dispatch_default_assignee: 'default',
      resolved_default_assignee: 'default',
      resolved_orchestrator_profile: 'default',
      review_dispatch: true
    })
  }
})

vi.mock('./api', async () => {
  const actual = await vi.importActual('./api')

  const board: KanbanBoard = {
    assignees: [],
    columns: [{ name: 'triage', tasks: [] }],
    latest_event_id: 1,
    now: 1000,
    tenants: []
  }

  return {
    ...actual,
    createTask: vi.fn(),
    fetchBoard: vi.fn(() => Promise.resolve(board)),
    fetchBoards: vi.fn(() =>
      Promise.resolve({
        boards: [
          {
            counts: { ready: 3, scheduled: 2, todo: 0, triage: 0 },
            default_workspace_kind: 'scratch',
            name: 'Default',
            slug: 'default',
            total: 5
          },
          {
            counts: { blocked: 1, ready: 0, review: 1 },
            default_workspace_kind: 'scratch',
            name: 'Ops',
            slug: 'ops',
            total: 2
          }
        ],
        current: 'default'
      })
    ),
    fetchProfiles: vi.fn(() => Promise.resolve({ profiles: [] }))
  }
})

// Radix DropdownMenu touches pointer-capture + scrollIntoView while opening;
// jsdom does not implement those browser APIs.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

const task = (id: string, created_at: number, priority = 0): KanbanTask => ({
  created_at,
  id,
  priority,
  status: 'done',
  title: id
})

describe('kanban board time sorting', () => {
  it('sorts each column oldest-first by task creation time regardless of priority', () => {
    const tasks = [task('t_new_high', 300, 2), task('t_old_low', 100, 0), task('t_mid_high', 200, 10)]

    expect(sortColumnTasks(tasks, 'asc').map(t => t.id)).toEqual(['t_old_low', 't_mid_high', 't_new_high'])
  })

  it('can reverse each column newest-first by task creation time regardless of priority', () => {
    const tasks = [task('t_old_high', 100, 10), task('t_new_low', 300, 0), task('t_mid_high', 200, 2)]

    expect(sortColumnTasks(tasks, 'desc').map(t => t.id)).toEqual(['t_new_low', 't_mid_high', 't_old_high'])
  })

  it('keeps sort direction independent per column', () => {
    const directions: Partial<Record<string, TaskSortDirection>> = { done: 'desc' }

    expect(taskSortDirectionForColumn(directions, 'done')).toBe('desc')
    expect(taskSortDirectionForColumn(directions, 'ready')).toBe('asc')
    expect(toggleColumnSortDirection(directions, 'done')).toEqual({ done: 'asc' })
    expect(toggleColumnSortDirection(directions, 'ready')).toEqual({ done: 'desc', ready: 'desc' })
  })

  it('includes task tags in the board search text', () => {
    expect(
      taskTagsLabel({
        id: 't_demo',
        status: 'ready',
        tags: [{ id: 1, name: 'Feature Alpha', normalized_name: 'feature alpha' }],
        title: 'Demo'
      })
    ).toContain('Feature Alpha')
  })

  it('identifies AI-managed tags from the backend namespace for special rendering', () => {
    expect(isAiManagedTag({ name: 'AI:Status Ready', normalized_name: 'ai:status ready' })).toBe(true)
    expect(isAiManagedTag({ name: 'Feature Alpha', normalized_name: 'feature alpha' })).toBe(false)
  })
})

describe('kanban board layout sizing', () => {
  it('keeps lanes wider than the former compact 16rem width while allowing narrow screens to fit', () => {
    expect(KANBAN_LANE_WIDTH_CLASS).toContain('22rem')
    expect(KANBAN_LANE_WIDTH_CLASS).toContain('md:w-80')
    expect(KANBAN_LANE_WIDTH_CLASS).toContain('calc(100vw-2rem)')
    expect(KANBAN_LANE_WIDTH_CLASS).not.toContain('w-64')
  })
})

describe('taskTimeLabel', () => {
  it('renders relative card times with the absolute datetime in the tooltip', () => {
    render(<>{taskTimeLabel({ created_at: 60, id: 't_demo', status: 'done', title: 'Demo' }, 'relative', 120_000)}</>)

    const label = screen.getByText('1 min. ago')

    expect(label).toBeTruthy()
    expect(label.getAttribute('title')).toBeTruthy()
    expect(label.getAttribute('title')).not.toBe('1 min. ago')
  })

  it('can render the card timestamp as a datetime', () => {
    render(<>{taskTimeLabel({ created_at: 60, id: 't_demo', status: 'done', title: 'Demo' }, 'datetime', 120_000)}</>)

    expect(screen.queryByText('1 min. ago')).toBeNull()
    expect(screen.getByTitle('1 min. ago')).toBeTruthy()
  })
})

describe('arcState', () => {
  it('uses current_run_id for strong running state while allowing legacy rows', () => {
    expect(arcState({ current_run_id: 7, id: 't_run', status: 'running', title: 'Run' }, '')).toBe('running')
    expect(arcState({ current_run_id: null, id: 't_orphan', status: 'running', title: 'Orphan' }, '')).toBeNull()
    expect(arcState({ id: 't_legacy', status: 'running', title: 'Legacy' }, '')).toBe('running')
  })

  it('marks only dispatcher/decomposer-eligible waiting cards as queued', () => {
    const settings = { autoDecompose: true, fallbackAssignee: '', reviewDispatch: true }

    expect(arcState({ id: 't_triage', status: 'triage', title: 'Triage' }, settings)).toBe('queued')
    expect(
      arcState({ id: 't_triage_idle', status: 'triage', title: 'Triage' }, { ...settings, autoDecompose: false })
    ).toBeNull()
    expect(arcState({ id: 't_ready', status: 'ready', title: 'Ready' }, settings)).toBeNull()
    expect(arcState({ assignee: 'default', id: 't_ready_owned', status: 'ready', title: 'Ready' }, settings)).toBe(
      'queued'
    )
    expect(
      arcState({ id: 't_ready_default', status: 'ready', title: 'Ready' }, { ...settings, fallbackAssignee: 'default' })
    ).toBe('queued')
    expect(arcState({ assignee: 'default', id: 't_review', status: 'review', title: 'Review' }, settings)).toBe(
      'queued'
    )
    expect(
      arcState(
        { assignee: 'default', id: 't_review_manual', status: 'review', title: 'Review' },
        { ...settings, reviewDispatch: false }
      )
    ).toBeNull()
  })

  it('only queues todo cards when dependencies are satisfied and routing exists', () => {
    expect(
      arcState({ assignee: 'default', id: 't_todo', parents_satisfied: true, status: 'todo', title: 'Todo' }, '')
    ).toBe('queued')
    expect(arcState({ id: 't_todo_default', parents_satisfied: true, status: 'todo', title: 'Todo' }, 'default')).toBe(
      'queued'
    )
    expect(
      arcState(
        { assignee: 'default', id: 't_todo_waiting', parents_satisfied: false, status: 'todo', title: 'Todo' },
        ''
      )
    ).toBeNull()
    expect(arcState({ id: 't_todo_parked', parents_satisfied: true, status: 'todo', title: 'Todo' }, '')).toBeNull()
  })
})

describe('minimized new task drafts', () => {
  it('keeps the dialog minimize action on the close-button control rail', () => {
    expect(NEW_TASK_MINIMIZE_BUTTON_SIZE).toBe('icon-xs')
    expect(NEW_TASK_MINIMIZE_BUTTON_CLASS).toContain('absolute')
    expect(NEW_TASK_MINIMIZE_BUTTON_CLASS).toContain('top-2.5')
    expect(NEW_TASK_MINIMIZE_BUTTON_CLASS).toContain('right-10')
    expect(NEW_TASK_MINIMIZE_BUTTON_CLASS).not.toContain('ml-auto')
    expect(NEW_TASK_MINIMIZE_BUTTON_CLASS).not.toContain('mr-8')
  })

  it('keeps multiple independent new task drafts available for restore', () => {
    const first = updateNewTaskDraft(createNewTaskDraft('triage'), {
      bodyText: 'first body',
      title: 'First screenshot task'
    })

    const second = updateNewTaskDraft(createNewTaskDraft('ready'), { priority: '3', title: 'Second screenshot task' })

    expect(minimizedNewTaskDrafts([first, second]).map(draft => [draft.target, draft.title])).toEqual([
      ['triage', 'First screenshot task'],
      ['ready', 'Second screenshot task']
    ])
  })

  it('does not mutate the existing draft while typing into a restored draft', () => {
    const draft = createNewTaskDraft('triage')
    const edited = updateNewTaskDraft(draft, { title: 'Collect screenshots' })

    expect(draft.title).toBe('')
    expect(edited.title).toBe('Collect screenshots')
    expect(edited.id).toBe(draft.id)
  })

  it('moves the minimized draft bar above the bulk-selection bar', () => {
    expect(draftBarClassName(false)).toBe('bottom-4')
    expect(draftBarClassName(true)).toBe('bottom-14')
  })

  it('keeps a partially typed task and image preview when board defaults refetch before minimize', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <KanbanBoardPage />
      </QueryClientProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'New task' }))
    const title = await screen.findByPlaceholderText('What needs doing?')
    const body = screen.getByPlaceholderText('Description')

    fireEvent.change(title, { target: { value: 'Keep unsaved title' } })
    fireEvent.change(body, { target: { value: 'Keep unsaved body' } })
    fireEvent.paste(body, {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => new File(['png-bytes'], 'draft.png', { type: 'image/png' }) }]
      }
    })

    expect(await screen.findByRole('img', { name: 'draft.png' })).toBeTruthy()
    client.setQueryData(['kanban', 'boards'], {
      boards: [{ default_workspace_kind: 'worktree', slug: 'default' }],
      current: 'default'
    })
    await waitFor(() => expect((title as HTMLInputElement).value).toBe('Keep unsaved title'))

    fireEvent.click(screen.getByRole('button', { name: 'Minimize draft' }))
    expect(screen.getByText('Minimized drafts (1)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Keep unsaved title/ }))

    expect(((await screen.findByPlaceholderText('What needs doing?')) as HTMLInputElement).value).toBe(
      'Keep unsaved title'
    )
    expect((screen.getByPlaceholderText('Description') as HTMLTextAreaElement).value).toBe('Keep unsaved body')
    expect(screen.getByRole('img', { name: 'draft.png' })).toBeTruthy()
  })
})

describe('kanban board lane layout classes', () => {
  it('keeps vertical overflow at the board level instead of inside each lane', () => {
    expect(KANBAN_BOARD_SCROLL_CLASS).toContain('overflow-auto')
    expect(KANBAN_COLUMN_TASKS_CLASS).not.toContain('overflow-y-auto')
    expect(KANBAN_COLUMN_TASKS_CLASS).not.toContain('overflow-x-hidden')
  })

  it('keeps lanes wide enough for readable card content', () => {
    expect(KANBAN_LANE_WIDTH_CLASS).toContain('md:w-80')
    expect(KANBAN_LANE_WIDTH_CLASS).toContain('xl:w-[22rem]')
  })
})

describe('KanbanBoardPage header', () => {
  it('makes expanded and collapsed lane descriptions available as accessible tooltips', async () => {
    vi.mocked(fetchBoard).mockResolvedValueOnce({
      assignees: [],
      columns: [
        {
          name: 'triage',
          tasks: [{ created_at: 1, id: 't_triage', status: 'triage', title: 'Needs a spec' }]
        },
        { name: 'ready', tasks: [] }
      ],
      latest_event_id: 3,
      now: 1000,
      tenants: []
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <KanbanBoardPage />
      </QueryClientProvider>
    )

    const expandedLabel = await screen.findByText('Triage')
    const expandedTrigger = expandedLabel.closest('[data-slot="tooltip-trigger"]')

    expect(expandedTrigger).toBeTruthy()
    expect(expandedTrigger?.getAttribute('tabindex')).toBe('0')

    const collapsedTrigger = await screen.findByRole('button', { name: 'Expand Ready' })

    expect(collapsedTrigger.closest('[data-slot="tooltip-trigger"]')).toBeTruthy()
  })

  it('renders the board switcher in the content header and keeps board switching wired', async () => {
    $boardSlug.set('')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <KanbanBoardPage />
      </QueryClientProvider>
    )

    expect(screen.queryByRole('heading', { name: 'Kanban' })).toBeNull()

    const switcher = await screen.findByRole('button', { name: /Default/i })
    expect(switcher.textContent).toContain('2')
    expect(switcher.textContent).toContain('3')
    expect(switcher.textContent).not.toContain('5')
    expect(screen.getByTitle('2 Kanban Scheduled tasks')).toBeTruthy()
    expect(screen.getByTitle('3 Kanban Ready tasks')).toBeTruthy()
    expect(screen.queryByTitle('0 Kanban Todo tasks')).toBeNull()

    fireEvent.pointerDown(switcher, { button: 0, pointerType: 'mouse' })
    fireEvent.mouseDown(switcher, { button: 0 })
    fireEvent.click(switcher)
    const opsItem = await screen.findByRole('menuitem', { name: /Ops/i })
    expect(opsItem.textContent).toContain('1')
    expect(opsItem.textContent).not.toContain('2')
    expect(screen.getByTitle('1 Kanban Blocked task')).toBeTruthy()
    expect(screen.getByTitle('1 Kanban Review task')).toBeTruthy()
    fireEvent.click(opsItem)

    expect($boardSlug.get()).toBe('ops')
  })

  it('shows and clears the header loading indicator around board fetches', async () => {
    $boardSlug.set('')
    let resolveBoard!: (board: KanbanBoard) => void
    vi.mocked(fetchBoard).mockImplementationOnce(
      () =>
        new Promise<KanbanBoard>(resolve => {
          resolveBoard = resolve
        })
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <KanbanBoardPage />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('status', { name: 'Loading board…' })).toBeTruthy()
    resolveBoard({
      assignees: [],
      columns: [{ name: 'triage', tasks: [] }],
      latest_event_id: 2,
      now: 1000,
      tenants: []
    })
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading board…' })).toBeNull())
  })
})

// Compile-time exhaustiveness guard for the exported view state type.
const _sortDirections: TaskSortDirection[] = ['asc', 'desc']
void _sortDirections
