import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $boardSlug, boardKey, fetchBoard, fetchTask, markTaskRead, patchTask, taskKey } from './api'
import { KanbanCommentBody } from './comment-body'
import {
  AttachmentsSection,
  buildDiscussionItems,
  buildTimelineItems,
  buildWorkerTraceRows,
  CommentComposer,
  DependenciesSection,
  TaskDetailHeaderControls,
  TaskDrawer,
  TaskDrawerShell,
  TaskTagsSection,
  TimelineSection,
  TitleSection,
  WorkerLogSection
} from './drawer'
import type { KanbanBoard, KanbanTaskDetail, WorkerLog } from './types'
import { isUnreadAttentionCard } from './unread'

const testKanbanText = {
  activity: (count: number) => `Activity · ${count}`,
  addComment: 'Add a comment…',
  attachments: (count: number) => `Attachments (${count})`,
  close: 'Close',
  col: {
    blocked: { help: '', label: 'Blocked' },
    done: { help: '', label: 'Done' },
    ready: { help: '', label: 'Ready' },
    review: { help: '', label: 'Review' },
    running: { help: '', label: 'Running' }
  },
  archiveTask: 'Archive task',
  assignee: 'Assignee',
  blockedBy: 'Blocked by',
  blocks: 'Blocks',
  cancelEdit: 'Cancel',
  comment: 'Comment',
  comments: (count: number) => `Comments (${count})`,
  commentsHelp: 'Comments are sent to the task thread.',
  commentsHelpRunning: 'Comments can message the running worker.',
  commandCopied: 'Command copied',
  complexity: { L: 'Large', M: 'Medium', S: 'Small' },
  copiedId: (id: string) => `Copied ${id}`,
  copiedTitle: 'Copied title',
  copyTaskId: 'Copy task id',
  copyTitle: 'Copy title',
  couldNotEstimate: 'Could not estimate',
  deleteTask: 'Delete task',
  dependencies: 'Dependencies',
  description: 'Description',
  details: 'Details',
  diagnosticsN: (count: number) => `Diagnostics (${count})`,
  deliveredLive: 'Delivered live',
  evtAssignedTo: (assignee: string) => `assigned to ${assignee}`,
  evtArchived: 'archived',
  evtBlocked: 'blocked',
  evtClaimedReview: 'claimed review',
  evtClaimedWorker: 'claimed worker',
  evtCommentBy: (author: string) => `comment by ${author}`,
  evtCompleted: 'completed',
  evtCreated: (where: string, assignee: string) => `created ${where} ${assignee}`.trim(),
  evtMovedTo: (col: string) => `moved to ${col}`,
  evtParentReopened: (parent: string) => `parent reopened ${parent}`,
  evtPromoted: 'promoted',
  evtReclaimed: 'reclaimed',
  evtReprioritized: (priority: string) => `priority ${priority}`,
  evtScheduled: 'scheduled',
  evtSpecified: 'specified',
  evtTagAttached: (name: string) => `tag added: ${name}`,
  evtTagRemoved: (name: string) => `tag removed: ${name}`,
  evtAiTagAttached: (name: string) => `AI tag added: ${name}`,
  evtAiTagRemoved: (name: string) => `AI tag removed: ${name}`,
  evtAiTagsUpdated: 'AI updated tags automatically',
  evtAiTagsAdded: (names: string) => `added ${names}`,
  evtAiTagsRemoved: (names: string) => `removed ${names}`,
  evtUnassigned: 'unassigned',
  evtUnblocked: (col: string) => `unblocked ${col}`,
  evtWorkerStarted: 'worker started',
  editDescription: 'Edit description',
  estimate: 'Estimate',
  estimateEffort: 'Estimate effort',
  estimateTipLong: 'Estimate effort',
  estimating: 'Estimating…',
  makesModelCall: 'Makes a model call',
  metaCreated: 'Created',
  metaCreatedBy: 'Created by',
  metaPriority: 'Priority',
  metaTenant: 'Tenant',
  metaWorkerPid: 'Worker PID',
  model: 'Model',
  messageWorker: 'Message the running worker…',
  noAttachments: 'No attachments',
  noDescription: 'No description',
  notePosted: 'Note posted',
  openAsDialog: 'Open as dialog',
  openAsSideSheet: 'Open as side sheet',
  readyUnassignedBody: 'Assign a worker before dispatch.',
  readyUnassignedTitle: 'Ready but unassigned',
  reEstimate: 'Re-estimate',
  requeueWithNote: 'Requeue with note',
  runs: (count: number) => `Runs · ${count}`,
  save: 'Save',
  send: 'Send',
  tabActivity: 'Activity',
  tabDetails: 'Details',
  taskActions: 'Task actions',
  taskTitle: 'Title',
  titleRequired: 'Title is required.',
  tags: 'Tags',
  aiResultEntry: 'AI result',
  aiSummaryEntry: 'AI summary',
  aiTagBadge: 'AI',
  aiTagTip: 'Managed automatically by AI workflow updates; you can still remove it manually.',
  noTags: 'No tags yet.',
  tagName: 'Tag name',
  addTag: 'Add tag',
  existingTags: 'Existing tags',
  filterExistingTags: 'Filter existing tags',
  noExistingTagMatches: 'No tags match your filter.',
  addExistingTag: (name: string) => `Add existing tag ${name}`,
  removeTag: (name: string) => `Remove tag ${name}`,
  editTitle: 'Edit title',
  someone: 'someone',
  timeline: (count: number) => `Timeline (${count})`,
  timelineArchived: 'Archived',
  timelineAssigned: (assignee: string) => `Assigned to ${assignee}`,
  timelineCommented: (author: string) => `Comment from ${author}`,
  timelineCompleted: 'Work completed',
  timelineCreated: 'Task created',
  timelineLastAction: (action: string) => `latest action: ${action}`,
  timelineLastHeartbeat: (when: string) => `last heartbeat ${when}`,
  timelineNeedsInput: 'Needs human input',
  timelineRecentAction: 'Recent action',
  timelineNoActivity: 'No timeline activity yet.',
  timelineNoAssignee: 'No assignee yet',
  timelineReview: 'Waiting for review',
  timelineRunDetail: (profile: string, duration: string) => `${profile} run · ${duration}`,
  timelineRunProfile: (profile: string) => `${profile} run`,
  timelineWaitingIn: (column: string) => `Waiting in ${column}`,
  timelineWorking: 'Agent is working now',
  tokUnit: 'tok',
  unassigned: 'Unassigned',
  uploadAttachment: 'Upload attachment',
  workspace: 'Workspace',
  workerLog: 'Worker log',
  workerLogTail: 'Worker log · tail',
  workerLogEmpty: 'No worker log yet.'
}

vi.mock('./ui', async () => {
  const actual = await vi.importActual('./ui')

  return {
    ...actual,
    useDefaultAssignee: () => 'default',
    useKanban: () => testKanbanText
  }
})

vi.mock('./api', async () => {
  const actual = await vi.importActual('./api')

  return {
    ...actual,
    fetchBoard: vi.fn(),
    fetchLog: vi.fn(() => Promise.resolve({ content: '', exists: false, size_bytes: 0, truncated: false })),
    fetchProfiles: vi.fn(() => Promise.resolve({ profiles: [] })),
    fetchTags: vi.fn(() => Promise.resolve({ tags: [] })),
    fetchTask: vi.fn(),
    markTaskRead: vi.fn(),
    patchTask: vi.fn()
  }
})

afterEach(() => {
  vi.clearAllMocks()
  $boardSlug.set('')
  vi.unstubAllGlobals()
})

// jsdom does not exercise the OS clipboard; this covers the same paste-event
// data path the composer uses when Electron delivers a clipboard image item.
function pasteFile(target: HTMLElement, file: File) {
  fireEvent.paste(target, {
    clipboardData: {
      items: [{ type: file.type, getAsFile: () => file }]
    }
  })
}

function taskDetail(patch: Partial<KanbanTaskDetail['task']> = {}): KanbanTaskDetail {
  return {
    attachments: [],
    comments: [],
    events: [],
    links: { children: [], parents: [] },
    runs: [],
    task: {
      created_at: 1,
      id: 't_unread',
      is_unread: true,
      latest_unread_event_id: 7,
      status: 'done',
      title: 'Unread task',
      ...patch
    }
  }
}

function renderTaskDrawer(id: string, board: KanbanBoard) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
  client.setQueryData(boardKey('', false), board)

  render(
    <QueryClientProvider client={client}>
      <TaskDrawer columns={['done', 'blocked', 'review', 'ready']} id={id} onClose={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>
  )

  return client
}

function BoardBadgeProbe({ taskId }: { taskId: string }) {
  const { data: board } = useQuery({
    queryFn: () => fetchBoard(false),
    queryKey: boardKey('', false),
    staleTime: Infinity
  })
  const task = board?.columns.flatMap(column => column.tasks).find(candidate => candidate.id === taskId)

  return task && isUnreadAttentionCard(task) ? <span aria-label="Unread card" /> : null
}

describe('TaskDrawer read state', () => {
  it('marks an unread qualifying card as read after its detail opens', async () => {
    const id = 't_done_unread'
    vi.mocked(fetchTask).mockResolvedValue(taskDetail({ id, title: 'Unread done' }))
    vi.mocked(markTaskRead).mockResolvedValue({
      is_unread: false,
      last_read_event_id: 7,
      latest_unread_event_id: 7,
      read_at: 123,
      task_id: id
    })
    const board: KanbanBoard = {
      assignees: [],
      columns: [
        { name: 'done', tasks: [{ created_at: 1, id, is_unread: true, status: 'done', title: 'Unread done' }] }
      ],
      latest_event_id: 7,
      now: 123,
      tenants: []
    }

    const client = renderTaskDrawer(id, board)

    await waitFor(() => expect(markTaskRead).toHaveBeenCalledWith(id))
    await waitFor(() =>
      expect(client.getQueryData<KanbanBoard>(boardKey('', false))?.columns[0]?.tasks[0]?.is_unread).toBe(false)
    )
    expect(client.getQueryData<KanbanTaskDetail>(taskKey('', id))?.task.is_unread).toBe(false)
  })

  it('keeps the board badge cleared when the board refetches after marking read', async () => {
    const id = 't_done_unread'
    const unreadTask = { created_at: 1, id, is_unread: true, status: 'done', title: 'Unread done' }
    const readTask = {
      ...unreadTask,
      is_unread: false,
      last_read_event_id: 7,
      latest_unread_event_id: 7,
      read_at: 123
    }
    const initialBoard: KanbanBoard = {
      assignees: [],
      columns: [{ name: 'done', tasks: [unreadTask] }],
      latest_event_id: 7,
      now: 123,
      tenants: []
    }
    const refreshedBoard: KanbanBoard = {
      ...initialBoard,
      columns: [{ name: 'done', tasks: [readTask] }],
      now: 124
    }
    let resolveRead!: (state: Awaited<ReturnType<typeof markTaskRead>>) => void

    vi.mocked(fetchTask).mockResolvedValue(taskDetail({ id, title: 'Unread done' }))
    vi.mocked(markTaskRead).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRead = resolve
        })
    )
    vi.mocked(fetchBoard).mockResolvedValueOnce(refreshedBoard)

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    client.setQueryData(boardKey('', false), initialBoard)

    render(
      <QueryClientProvider client={client}>
        <BoardBadgeProbe taskId={id} />
        <TaskDrawer columns={['done', 'blocked', 'review', 'ready']} id={id} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>
    )

    expect(await screen.findByLabelText('Unread card')).toBeTruthy()
    await waitFor(() => expect(markTaskRead).toHaveBeenCalledWith(id))

    resolveRead({
      is_unread: false,
      last_read_event_id: 7,
      latest_unread_event_id: 7,
      read_at: 123,
      task_id: id
    })

    await waitFor(() => expect(screen.queryByLabelText('Unread card')).toBeNull())
    await waitFor(() => expect(fetchBoard).toHaveBeenCalledWith(false))
    expect(client.getQueryData<KanbanBoard>(boardKey('', false))?.columns[0]?.tasks[0]?.is_unread).toBe(false)
  })

  it('keeps unread cached when the mark-read request fails', async () => {
    const id = 't_blocked_unread'
    vi.mocked(fetchTask).mockResolvedValue(taskDetail({ id, status: 'blocked', title: 'Unread blocked' }))
    vi.mocked(markTaskRead).mockRejectedValue(new Error('read failed'))
    const board: KanbanBoard = {
      assignees: [],
      columns: [
        { name: 'blocked', tasks: [{ created_at: 1, id, is_unread: true, status: 'blocked', title: 'Unread blocked' }] }
      ],
      latest_event_id: 7,
      now: 123,
      tenants: []
    }

    const client = renderTaskDrawer(id, board)

    await waitFor(() => expect(markTaskRead).toHaveBeenCalledWith(id))
    expect(client.getQueryData<KanbanBoard>(boardKey('', false))?.columns[0]?.tasks[0]?.is_unread).toBe(true)
    expect(client.getQueryData<KanbanTaskDetail>(taskKey('', id))?.task.is_unread).toBe(true)
  })
})

describe('TitleSection', () => {
  it('edits an existing task title through the same save path as the description', () => {
    const onSave = vi.fn()

    render(<TitleSection onSave={onSave} title="Original task title" />)

    expect(screen.getByText('Original task title')).toBeTruthy()
    expect(screen.queryByText('Title')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))

    const input = screen.getByDisplayValue('Original task title') as HTMLInputElement
    expect(screen.queryByText('Original task title')).toBeNull()
    fireEvent.change(input, { target: { value: 'Updated task title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith('Updated task title')
  })

  it('does not save an empty title', () => {
    const onSave = vi.fn()

    render(<TitleSection onSave={onSave} title="Original task title" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    fireEvent.change(screen.getByDisplayValue('Original task title'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Title is required.')
  })

  it('cancels local title edits without saving', () => {
    const onSave = vi.fn()

    render(<TitleSection onSave={onSave} title="Readable title" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    fireEvent.change(screen.getByDisplayValue('Readable title'), { target: { value: 'Draft title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Readable title')).toBeTruthy()
    expect(screen.queryByDisplayValue('Draft title')).toBeNull()
  })

  it('saves a valid title with Enter', async () => {
    const onSave = vi.fn()

    render(<TitleSection onSave={onSave} title="Keyboard title" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    const input = screen.getByLabelText('Title')
    fireEvent.change(input, { target: { value: '  Saved by Enter  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Saved by Enter'))
    await waitFor(() => expect(screen.queryByDisplayValue('  Saved by Enter  ')).toBeNull())
  })

  it('cancels title editing with Escape', () => {
    const onSave = vi.fn()

    render(<TitleSection onSave={onSave} title="Readable title" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    const input = screen.getByDisplayValue('Readable title')
    fireEvent.change(input, { target: { value: 'Draft title' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Readable title')).toBeTruthy()
    expect(screen.queryByDisplayValue('Draft title')).toBeNull()
  })

  it('keeps editing and shows the save error when title persistence fails', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('Save failed')
    })

    render(<TitleSection onSave={onSave} title="Readable title" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    fireEvent.change(screen.getByDisplayValue('Readable title'), { target: { value: 'Changed title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Save failed'))
    expect(screen.getByDisplayValue('Changed title')).toBeTruthy()
  })

  it('loads an existing drawer title once and saves edits through patchTask', async () => {
    const id = 't_title_edit'
    vi.mocked(fetchTask).mockResolvedValue(
      taskDetail({ id, is_unread: false, status: 'ready', title: 'Existing drawer title' })
    )
    vi.mocked(patchTask).mockResolvedValue({})

    const board: KanbanBoard = {
      assignees: [],
      columns: [{ name: 'ready', tasks: [{ created_at: 1, id, status: 'ready', title: 'Existing drawer title' }] }],
      latest_event_id: 7,
      now: 123,
      tenants: []
    }

    renderTaskDrawer(id, board)

    expect(await screen.findByText('Existing drawer title')).toBeTruthy()
    expect(screen.queryByText('Title')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    const input = screen.getByLabelText('Title') as HTMLInputElement
    expect(input.value).toBe('Existing drawer title')
    expect(screen.queryByText('Existing drawer title')).toBeNull()

    fireEvent.change(input, { target: { value: 'Renamed from drawer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patchTask).toHaveBeenCalledWith(id, { title: 'Renamed from drawer' }))
    await waitFor(() => expect(screen.queryByDisplayValue('Renamed from drawer')).toBeNull())
  })
})

describe('TaskTagsSection', () => {
  it('renders the current tags and removes a selected tag', () => {
    const onRemove = vi.fn()

    render(
      <TaskTagsSection
        existingTags={[]}
        onAdd={vi.fn()}
        onRemove={onRemove}
        pending={false}
        tags={[{ id: 1, name: 'Frontend', normalized_name: 'frontend' }]}
      />
    )

    expect(screen.getByText('Frontend')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Frontend' }))

    expect(onRemove).toHaveBeenCalledWith('Frontend')
  })

  it('marks AI-managed tags while keeping manual removal available', () => {
    const onRemove = vi.fn()

    render(
      <TaskTagsSection
        existingTags={[]}
        onAdd={vi.fn()}
        onRemove={onRemove}
        pending={false}
        tags={[{ id: 1, name: 'AI:Status Ready', normalized_name: 'ai:status ready' }]}
      />
    )

    expect(screen.getByText('Status Ready')).toBeTruthy()
    expect(screen.queryByText('AI:Status Ready')).toBeNull()
    expect(screen.getByText('AI')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag AI:Status Ready' }))

    expect(onRemove).toHaveBeenCalledWith('AI:Status Ready')
  })

  it('renders business feature/module tags while leaving manual status labels intact', () => {
    const onAdd = vi.fn()
    const onRemove = vi.fn()

    render(
      <TaskTagsSection
        existingTags={[{ id: 4, name: 'AI:Feature Churn Module', normalized_name: 'ai:feature churn module' }]}
        onAdd={onAdd}
        onRemove={onRemove}
        pending={false}
        tags={[
          { id: 1, name: 'Billing Module', normalized_name: 'billing module' },
          { id: 2, name: 'Feature: Invoice Sync', normalized_name: 'feature: invoice sync' },
          { id: 3, name: 'Status: Customer Ready', normalized_name: 'status: customer ready' }
        ]}
      />
    )

    expect(screen.getByText('Billing Module')).toBeTruthy()
    expect(screen.getByText('Feature: Invoice Sync')).toBeTruthy()
    expect(screen.getByText('Status: Customer Ready')).toBeTruthy()

    fireEvent.focus(screen.getByRole('combobox', { name: 'Tag name' }))
    expect(screen.queryByLabelText('Filter existing tags')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add existing tag AI:Feature Churn Module' }).textContent).toContain(
      'Feature Churn Module'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Status: Customer Ready' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add existing tag AI:Feature Churn Module' }))

    expect(onRemove).toHaveBeenCalledWith('Status: Customer Ready')
    expect(onAdd).toHaveBeenCalledWith('AI:Feature Churn Module')
  })

  it('opens the existing-tags panel from the tag-name combobox and closes it with Escape', () => {
    render(
      <TaskTagsSection
        existingTags={[
          { id: 1, name: 'Backend', normalized_name: 'backend' },
          { id: 2, name: 'Frontend', normalized_name: 'frontend' }
        ]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        pending={false}
        tags={[]}
      />
    )

    const tagNameInput = screen.getByRole('combobox', { name: 'Tag name' })

    expect(tagNameInput.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Existing tags' })).toBeNull()
    expect(screen.queryByLabelText('Filter existing tags')).toBeNull()

    fireEvent.focus(tagNameInput)

    expect(tagNameInput.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('listbox', { name: 'Existing tags' })).toBeTruthy()
    expect(screen.queryByLabelText('Filter existing tags')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add existing tag Frontend' })).toBeTruthy()

    fireEvent.keyDown(tagNameInput, { key: 'Escape' })

    expect(tagNameInput.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Add existing tag Frontend' })).toBeNull()
  })

  it('lets users filter and attach an existing tag from the tag-name combobox', () => {
    const onAdd = vi.fn()

    render(
      <TaskTagsSection
        existingTags={[
          { id: 1, name: 'Backend', normalized_name: 'backend' },
          { id: 2, name: 'Frontend', normalized_name: 'frontend' },
          { id: 3, name: 'Release Train', normalized_name: 'release train' }
        ]}
        onAdd={onAdd}
        onRemove={vi.fn()}
        pending={false}
        tags={[{ id: 1, name: 'Backend', normalized_name: 'backend' }]}
      />
    )

    expect(screen.queryByRole('button', { name: 'Add existing tag Backend' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add existing tag Frontend' })).toBeNull()

    const tagNameInput = screen.getByRole('combobox', { name: 'Tag name' }) as HTMLInputElement

    tagNameInput.focus()
    fireEvent.focus(tagNameInput)

    expect(document.activeElement).toBe(tagNameInput)

    expect(screen.queryByRole('button', { name: 'Add existing tag Backend' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add existing tag Frontend' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add existing tag Release Train' })).toBeTruthy()

    fireEvent.change(tagNameInput, { target: { value: 'FRONT' } })

    expect(screen.getByRole('button', { name: 'Add existing tag Frontend' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add existing tag Release Train' })).toBeNull()

    fireEvent.change(tagNameInput, { target: { value: 'missing' } })

    expect(screen.getByText('No tags match your filter.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add existing tag Frontend' })).toBeNull()

    fireEvent.change(tagNameInput, { target: { value: 'front' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add existing tag Frontend' }))

    expect(onAdd).toHaveBeenCalledWith('Frontend')
    expect(tagNameInput.value).toBe('')
  })

  it('lets users create and attach a new tag name', () => {
    const onAdd = vi.fn()

    render(<TaskTagsSection existingTags={[]} onAdd={onAdd} onRemove={vi.fn()} pending={false} tags={[]} />)

    fireEvent.change(screen.getByLabelText('Tag name'), { target: { value: 'release train' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))

    expect(onAdd).toHaveBeenCalledWith('release train')
    expect((screen.getByLabelText('Tag name') as HTMLInputElement).value).toBe('')
  })

  it('renders tag controls inside the shared detail card shell', () => {
    render(<TaskTagsSection existingTags={[]} onAdd={vi.fn()} onRemove={vi.fn()} pending={false} tags={[]} />)

    expect(screen.getByText('No tags yet.').closest('div')?.className).toContain('rounded-lg')
  })
})

describe('TaskDrawerShell layout', () => {
  it('renders a resizable side sheet with a dialog toggle next to close', () => {
    render(
      <TaskDrawerShell mode="sheet" onPaste={vi.fn()}>
        <TaskDetailHeaderControls mode="sheet" onClose={vi.fn()} onToggleMode={vi.fn()} />
        <p>Task content</p>
      </TaskDrawerShell>
    )

    const shell = screen.getByTestId('kanban-task-detail-shell')
    expect(shell.className).toContain('resize-x')
    expect(shell.className).toContain('w-[clamp(26rem,38vw,72rem)]')
    expect(screen.getByRole('button', { name: 'Open as dialog' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('renders dialog mode without the fixed side-sheet width and can toggle back', () => {
    render(
      <TaskDrawerShell mode="dialog" onPaste={vi.fn()}>
        <TaskDetailHeaderControls mode="dialog" onClose={vi.fn()} onToggleMode={vi.fn()} />
        <p>Task content</p>
      </TaskDrawerShell>
    )

    const shell = screen.getByTestId('kanban-task-detail-shell')
    expect(shell.className).not.toContain('w-[26rem]')
    expect(shell.className).toContain('w-[min(68rem,94vw)]')
    expect(screen.getByRole('button', { name: 'Open as side sheet' })).toBeTruthy()
  })
})

describe('CommentComposer pasted images', () => {
  it('uses the resolved preview image source while submitted comment markdown still renders as an attachment image', async () => {
    vi.stubGlobal('hermesDesktop', {
      getConnection: vi.fn().mockResolvedValue({
        authMode: 'token',
        baseUrl: 'http://127.0.0.1:8765',
        token: 'preview-token'
      })
    })

    const onPasteImages = vi
      .fn()
      .mockResolvedValue([{ id: 7, filename: 'clip.png', url: '/api/plugins/kanban/attachments/7' }])

    const onSubmit = vi.fn()

    render(<CommentComposer onPasteImages={onPasteImages} onSubmit={onSubmit} pending={false} />)

    const textarea = screen.getByPlaceholderText('Add a comment…')
    fireEvent.change(textarea, { target: { value: 'context' } })
    pasteFile(textarea, new File(['png-bytes'], 'clip.png', { type: 'image/png' }))

    const preview = await screen.findByRole('img', { name: 'clip.png' })
    await waitFor(() =>
      expect(preview.getAttribute('src')).toBe(
        'http://127.0.0.1:8765/api/plugins/kanban/attachments/7?token=preview-token'
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    const submittedMarkdown = 'context\n\n![clip.png](/api/plugins/kanban/attachments/7)'
    expect(onSubmit).toHaveBeenCalledWith(submittedMarkdown)

    render(<KanbanCommentBody body={submittedMarkdown} />)
    const postedImage = screen.getAllByRole('img', { name: 'clip.png' }).at(-1) as HTMLImageElement
    await waitFor(() =>
      expect(postedImage.getAttribute('src')).toBe(
        'http://127.0.0.1:8765/api/plugins/kanban/attachments/7?token=preview-token'
      )
    )
  })

  it('uploads pasted images as valid resolved previews without submitting the comment until the user clicks Comment', async () => {
    vi.stubGlobal('hermesDesktop', {
      getConnection: vi.fn().mockResolvedValue({
        authMode: 'token',
        baseUrl: 'http://127.0.0.1:8765',
        token: 'preview-token'
      })
    })

    const onPasteImages = vi
      .fn()
      .mockResolvedValue([{ id: 7, filename: 'clip.png', url: '/api/plugins/kanban/attachments/7' }])

    const onSubmit = vi.fn()

    render(<CommentComposer onPasteImages={onPasteImages} onSubmit={onSubmit} pending={false} />)

    const textarea = screen.getByPlaceholderText('Add a comment…')
    fireEvent.change(textarea, { target: { value: 'context' } })
    pasteFile(textarea, new File(['png-bytes'], 'clip.png', { type: 'image/png' }))

    await waitFor(() => expect(onPasteImages).toHaveBeenCalledTimes(1))
    expect(onSubmit).not.toHaveBeenCalled()

    const preview = await screen.findByRole('img', { name: 'clip.png' })
    await waitFor(() =>
      expect(preview.getAttribute('src')).toBe(
        'http://127.0.0.1:8765/api/plugins/kanban/attachments/7?token=preview-token'
      )
    )
    expect((textarea as HTMLTextAreaElement).value).toBe('context')

    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(onSubmit).toHaveBeenCalledWith('context\n\n![clip.png](/api/plugins/kanban/attachments/7)')
  })

  it('lets users remove a pasted image preview before submitting the comment', async () => {
    const onPasteImages = vi.fn().mockResolvedValue([
      { id: 7, filename: 'keep.png', url: '/api/plugins/kanban/attachments/7' },
      { id: 8, filename: 'remove.png', url: '/api/plugins/kanban/attachments/8' }
    ])

    const onSubmit = vi.fn()

    render(<CommentComposer onPasteImages={onPasteImages} onSubmit={onSubmit} pending={false} />)

    const textarea = screen.getByPlaceholderText('Add a comment…')
    fireEvent.change(textarea, { target: { value: 'context' } })
    pasteFile(textarea, new File(['png-bytes'], 'clip.png', { type: 'image/png' }))

    await screen.findByRole('img', { name: 'keep.png' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove remove.png from comment preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(onSubmit).toHaveBeenCalledWith('context\n\n![keep.png](/api/plugins/kanban/attachments/7)')
  })

  it('ignores non-image clipboard data so normal text paste can continue', () => {
    const onPasteImages = vi.fn()
    const onSubmit = vi.fn()

    render(<CommentComposer onPasteImages={onPasteImages} onSubmit={onSubmit} pending={false} />)

    const textarea = screen.getByPlaceholderText('Add a comment…')
    fireEvent.change(textarea, { target: { value: 'context' } })
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ type: 'text/plain', getAsFile: () => new File(['hello'], 'hello.txt', { type: 'text/plain' }) }]
      }
    })

    expect(onPasteImages).not.toHaveBeenCalled()
    expect((textarea as HTMLTextAreaElement).value).toBe('context')
  })

  it('keeps the draft and omits previews when pasted image upload fails', async () => {
    const onPasteImages = vi.fn().mockRejectedValue(new Error('upload failed'))
    const onSubmit = vi.fn()

    render(<CommentComposer onPasteImages={onPasteImages} onSubmit={onSubmit} pending={false} />)

    const textarea = screen.getByPlaceholderText('Add a comment…')
    fireEvent.change(textarea, { target: { value: 'context' } })
    pasteFile(textarea, new File(['png-bytes'], 'clip.png', { type: 'image/png' }))

    await waitFor(() => expect(onPasteImages).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull())
    expect((textarea as HTMLTextAreaElement).value).toBe('context')

    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(onSubmit).toHaveBeenCalledWith('context')
  })
})

describe('AttachmentsSection pasted images', () => {
  it('uploads pasted images as attachments without using the file-picker upload path', async () => {
    const onPasteImages = vi.fn().mockResolvedValue(undefined)
    const onUpload = vi.fn()

    render(<AttachmentsSection attachments={[]} onPasteImages={onPasteImages} onUpload={onUpload} pending={false} />)

    const dropZone = screen.getByTitle('Paste images here to add them as attachments')
    pasteFile(dropZone, new File(['png-bytes'], 'clip.png', { type: 'image/png' }))

    await waitFor(() => expect(onPasteImages).toHaveBeenCalledTimes(1))
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('keeps normal file-picker uploads working independently from image paste', () => {
    const onPasteImages = vi.fn()
    const onUpload = vi.fn()

    const { container } = render(
      <AttachmentsSection attachments={[]} onPasteImages={onPasteImages} onUpload={onUpload} pending={false} />
    )

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['report'], 'report.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(onUpload).toHaveBeenCalledWith(file)
    expect(onPasteImages).not.toHaveBeenCalled()
  })
})

describe('buildDiscussionItems', () => {
  it('mixes comments, task results, and every run summary chronologically with AI markers', () => {
    const detail = {
      attachments: [],
      comments: [
        { id: 1, author: 'samuel', body: 'Please reprocess this.', created_at: 1010 },
        { id: 2, author: 'samuel', body: 'Second note.', created_at: 1040 }
      ],
      events: [],
      links: { children: [], parents: [] },
      runs: [
        {
          ended_at: 1020,
          id: 7,
          outcome: 'completed',
          profile: 'default',
          started_at: 1015,
          status: 'closed',
          summary: 'First AI pass.'
        },
        {
          ended_at: 1050,
          id: 8,
          outcome: 'completed',
          profile: 'reviewer',
          started_at: 1045,
          status: 'closed',
          summary: 'Second AI pass.'
        },
        {
          ended_at: 1060,
          id: 9,
          outcome: 'completed',
          profile: 'default',
          started_at: 1055,
          status: 'closed',
          summary: 'status changed to ready (dashboard/direct)'
        }
      ],
      task: {
        completed_at: 1030,
        created_at: 1000,
        id: 't_demo',
        result: 'Legacy task result.',
        status: 'done',
        title: 'Demo'
      }
    } as KanbanTaskDetail

    expect(buildDiscussionItems(detail).map(item => ({ body: item.body, kind: item.kind }))).toEqual([
      { body: 'Please reprocess this.', kind: 'comment' },
      { body: 'First AI pass.', kind: 'ai-summary' },
      { body: 'Legacy task result.', kind: 'ai-result' },
      { body: 'Second note.', kind: 'comment' },
      { body: 'Second AI pass.', kind: 'ai-summary' }
    ])
  })

  it('does not duplicate task.result when it matches a run handoff', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [
        {
          ended_at: 1020,
          id: 7,
          outcome: 'completed',
          profile: 'default',
          started_at: 1015,
          status: 'closed',
          summary: 'Same handoff.'
        }
      ],
      task: {
        completed_at: 1020,
        created_at: 1000,
        id: 't_demo',
        result: 'Same handoff.',
        status: 'done',
        title: 'Demo'
      }
    } as KanbanTaskDetail

    expect(buildDiscussionItems(detail)).toHaveLength(1)
    expect(buildDiscussionItems(detail)[0]).toMatchObject({ body: 'Same handoff.', kind: 'ai-summary' })
  })
})

describe('buildTimelineItems', () => {
  it('summarizes events and the current running action without exposing raw logs', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [
        { id: 1, created_at: 1000, kind: 'created', payload: { assignee: 'default', status: 'ready' } },
        { id: 2, created_at: 1010, kind: 'claimed', payload: {} },
        { id: 3, created_at: 1020, kind: 'heartbeat', payload: null }
      ],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1010, status: 'running' }],
      task: {
        assignee: 'default',
        created_at: 995,
        id: 't_demo',
        last_heartbeat_at: 1020,
        status: 'running',
        title: 'Demo'
      }
    } as KanbanTaskDetail

    const log = {
      content: "│ 🔎 grep    'timeline'  0.1s\n│ 💻 $\n",
      exists: true,
      size_bytes: 42,
      truncated: false
    } as WorkerLog

    const items = buildTimelineItems(detail, log, testKanbanText as never)

    expect(items.some(item => item.label === 'Task created')).toBe(true)
    expect(items.some(item => item.label === 'Agent is working now')).toBe(true)
    expect(items.at(-1)?.detail).not.toContain('latest action')
    expect(items.at(-1)?.actionTrace).toEqual([
      {
        at: 1020,
        detail: 'Searched the Kanban activity timeline and worker-update code.',
        id: 'worker-activity-summary',
        label: 'Work updates'
      }
    ])
    expect(items.some(item => item.label === 'heartbeat')).toBe(false)
    expect(items.at(-1)?.children).toEqual([
      {
        at: 1020,
        detail: 'The agent checked in once to show it is still active.',
        id: 'heartbeat-check-ins',
        label: 'Worker check-ins'
      }
    ])
  })

  it('folds event activity and run history into the same compact timeline', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [
        { id: 1, created_at: 1000, kind: 'created', payload: { assignee: 'default', status: 'ready' } },
        { id: 2, created_at: 1010, kind: 'heartbeat', payload: { note: 'checking package' } }
      ],
      links: { children: [], parents: [] },
      runs: [{ ended_at: 1030, id: 9, outcome: 'timed_out', profile: 'default', started_at: 1005, status: 'closed' }],
      task: { assignee: 'default', created_at: 995, id: 't_demo', status: 'blocked', title: 'Demo' }
    } as KanbanTaskDetail

    const items = buildTimelineItems(detail, undefined, testKanbanText as never)

    expect(items.map(item => item.label)).not.toContain('heartbeat')
    expect(items.at(-1)?.children).toMatchObject([{ label: 'Progress update', detail: 'checking package' }])
    expect(items.at(-1)?.children?.[0].detail).not.toContain('note=')
    expect(items.map(item => item.label)).toContain('default run · timed_out')
    expect(items.find(item => item.id === 'run-9')).toMatchObject({ tone: 'error' })
  })

  it('shows AI-managed tag changes as readable timeline activity', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [
        {
          id: 1,
          created_at: 1000,
          kind: 'ai_tags_updated',
          payload: {
            added: ['AI:Status Ready', 'AI:Feature Kanban'],
            reason: 'task status updated',
            removed: ['AI:Status Todo'],
            source: 'ai',
            trigger: 'status'
          }
        },
        {
          id: 2,
          created_at: 1001,
          kind: 'tag_attached',
          payload: { source: 'ai', tag: { name: 'AI:Status Ready', normalized_name: 'ai:status ready' } }
        },
        {
          id: 3,
          created_at: 1002,
          kind: 'tag_removed',
          payload: { tag: { name: 'Manual Review', normalized_name: 'manual review' } }
        }
      ],
      links: { children: [], parents: [] },
      runs: [],
      task: { created_at: 995, id: 't_demo', status: 'ready', title: 'Demo' }
    } as KanbanTaskDetail

    const items = buildTimelineItems(detail, undefined, testKanbanText as never)

    expect(items.map(item => item.label)).toContain('AI updated tags automatically')
    expect(items.find(item => item.id === 'event-1')?.detail).toBe(
      'added AI:Status Ready and AI:Feature Kanban · removed AI:Status Todo'
    )
    expect(items.map(item => item.label)).toContain('AI tag added: AI:Status Ready')
    expect(items.map(item => item.label)).toContain('tag removed: Manual Review')
  })

  it('prefers persisted activity timeline rows and groups noisy events', () => {
    const detail = {
      activity_timeline: [
        {
          actor: { id: 'default', type: 'agent' },
          created_at: 1005,
          id: 10,
          importance: 'normal',
          summary: 'Read the task context and selected the drawer implementation path.',
          title: 'Loaded task context',
          tone: 'done',
          type: 'agent.context'
        },
        {
          actor: { id: 'default', type: 'agent' },
          created_at: 1010,
          id: 11,
          importance: 'high',
          status: 'succeeded',
          summary: 'Ran focused Vitest coverage for the Kanban drawer.',
          title: 'Ran Kanban drawer tests',
          type: 'agent.verification'
        },
        {
          children: [
            {
              actor: { id: 'ai', type: 'ai_tagger' },
              created_at: 1020,
              id: 12,
              importance: 'low',
              summary: 'added AI:Status Ready',
              title: 'AI tag added: AI:Status Ready',
              type: 'tags.changed'
            },
            {
              actor: { id: 'ai', type: 'ai_tagger' },
              created_at: 1021,
              id: 13,
              importance: 'low',
              summary: 'removed AI:Status Todo',
              title: 'AI tag removed: AI:Status Todo',
              type: 'tags.changed'
            }
          ],
          created_at: 1020,
          group: { collapsed: true, count: 2, first_at: 1020, key: 'tags:auto', last_at: 1021, omitted_count: 0 },
          id: 'group-tags-auto-12-13',
          importance: 'low',
          summary: 'added AI:Status Ready; removed AI:Status Todo',
          title: 'AI updated tags automatically',
          type: 'tags.changed'
        }
      ],
      attachments: [],
      comments: [],
      events: [
        { id: 1, created_at: 1000, kind: 'tag_attached', payload: { source: 'ai', tag: { name: 'AI:Status Ready' } } }
      ],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1000, status: 'running' }],
      task: { assignee: 'default', created_at: 995, id: 't_demo', status: 'running', title: 'Demo' }
    } as KanbanTaskDetail

    const log = {
      content: '  ┊ 📖 read      raw-log-only.tsx  0.1s',
      exists: true,
      size_bytes: 44,
      truncated: false
    } as WorkerLog

    const items = buildTimelineItems(detail, log, testKanbanText as never)

    expect(items.map(item => item.label)).toEqual([
      'Loaded task context',
      'Ran Kanban drawer tests',
      'AI updated tags automatically'
    ])
    expect(items[1]).toMatchObject({ detail: 'Ran focused Vitest coverage for the Kanban drawer.', tone: 'done' })
    expect(items[2]).toMatchObject({ group: { count: 2 }, tone: 'info' })
    expect(items[2].children?.map(child => child.label)).toEqual([
      'AI tag added: AI:Status Ready',
      'AI tag removed: AI:Status Todo'
    ])
    expect(items.some(item => item.label === 'Agent is working now')).toBe(false)
    expect(items.some(item => item.label === 'AI tag added: AI:Status Ready')).toBe(false)
    expect(items.some(item => item.label === 'Work updates')).toBe(false)
  })

  it('uses durable grouped agent step descriptions, statuses, and start times', () => {
    const detail = {
      activity_timeline: [
        {
          actor: { id: 'default', type: 'agent' },
          created_at: 1010,
          description: 'The agent is reading the related UI code to understand the Activity timeline behavior.',
          ended_at: 1020,
          id: 10,
          importance: 'normal',
          source_kind: 'agent_step',
          started_at: 1005,
          status: 'progress',
          summary: 'A shorter technical fallback.',
          title: 'Inspecting relevant files',
          type: 'agent.file_inspection'
        }
      ],
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1000, status: 'running' }],
      task: { assignee: 'default', created_at: 995, id: 't_demo', status: 'running', title: 'Demo' }
    } as KanbanTaskDetail

    const items = buildTimelineItems(detail, undefined, testKanbanText as never)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      at: 1005,
      detail: 'The agent is reading the related UI code to understand the Activity timeline behavior.',
      label: 'Inspecting relevant files',
      status: 'progress',
      tone: 'current'
    })

    render(<TimelineSection detail={detail} />)

    expect(screen.getByText('Inspecting relevant files')).toBeTruthy()
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(
      screen.getByText('The agent is reading the related UI code to understand the Activity timeline behavior.')
    ).toBeTruthy()
  })

  it('renders concrete tool evidence from persisted activity details', () => {
    const detail = {
      activity_timeline: [
        {
          actor: { id: 'default', type: 'agent' },
          created_at: 1010,
          details: {
            children: [
              {
                id: 'tool-read-drawer',
                summary: 'Returned 240 of 2977 lines',
                title: 'Read apps/desktop/src/plugins/kanban/drawer.tsx',
                type: 'agent.file_read'
              },
              {
                id: 'tool-search-activity',
                summary: 'Found 7 matches under plugins/kanban',
                title: 'Searched activity_timeline',
                type: 'agent.file_search'
              }
            ],
            counts: { files: 2, matches: 7, tools: 2 },
            files: [
              { action: 'read', path: 'apps/desktop/src/plugins/kanban/drawer.tsx' },
              { action: 'searched', matches: 7, path: 'plugins/kanban' }
            ],
            output: { redacted: true, truncated: true },
            work_summary: 'Read drawer.tsx; searched activity_timeline'
          },
          id: 10,
          importance: 'normal',
          source_kind: 'agent_step',
          started_at: 1005,
          status: 'succeeded',
          summary: 'Generic inspection fallback.',
          title: 'Inspecting relevant files',
          type: 'agent.file_inspection'
        }
      ],
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1000, status: 'running' }],
      task: { assignee: 'default', created_at: 995, id: 't_demo', status: 'running', title: 'Demo' }
    } as KanbanTaskDetail

    const items = buildTimelineItems(detail, undefined, testKanbanText as never)

    expect(items).toHaveLength(1)
    expect(items[0].detail).toContain('Read drawer.tsx; searched activity_timeline')
    expect(items[0].detail).toContain('used 2 tools')
    expect(items[0].detail).toContain('7 matches')
    expect(items[0].detail).toContain('output redacted, output truncated')
    expect(items[0].detail).not.toContain('Generic inspection fallback')
    expect(items[0].children?.map(child => child.label)).toEqual([
      'Read apps/desktop/src/plugins/kanban/drawer.tsx',
      'Searched activity_timeline'
    ])
    expect(items[0].children?.[0].detail).toBe('Returned 240 of 2977 lines')
  })

  it('renders running, completed, and failed grouped step statuses', () => {
    const detail = {
      activity_timeline: [
        {
          actor: { id: 'default', type: 'agent' },
          created_at: 1010,
          description: 'The agent is still checking the relevant files.',
          id: 10,
          source_kind: 'agent_step',
          started_at: 1005,
          status: 'progress',
          title: 'Inspecting relevant files',
          type: 'agent.file_inspection'
        },
        {
          actor: { id: 'default', type: 'agent' },
          created_at: 1020,
          description: 'The focused Activity timeline tests passed.',
          id: 11,
          source_kind: 'agent_step',
          started_at: 1015,
          status: 'succeeded',
          title: 'Running verification',
          type: 'agent.verification'
        },
        {
          actor: { id: 'default', type: 'agent' },
          created_at: 1030,
          description: 'A command failed and the agent is using that output to recover.',
          id: 12,
          source_kind: 'agent_step',
          started_at: 1025,
          status: 'failed',
          title: 'Recovering from a failed command',
          type: 'agent.error_retry'
        }
      ],
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1000, status: 'running' }],
      task: { assignee: 'default', created_at: 995, id: 't_demo', status: 'running', title: 'Demo' }
    } as KanbanTaskDetail

    const items = buildTimelineItems(detail, undefined, testKanbanText as never)

    expect(items.map(item => ({ label: item.label, status: item.status, tone: item.tone }))).toEqual([
      { label: 'Inspecting relevant files', status: 'progress', tone: 'current' },
      { label: 'Running verification', status: 'succeeded', tone: 'done' },
      { label: 'Recovering from a failed command', status: 'failed', tone: 'error' }
    ])

    render(<TimelineSection detail={detail} />)

    expect(screen.getByText('In progress')).toBeTruthy()
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('uses current status fallback messaging when worker logs are missing', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [
        { id: 1, created_at: 1000, kind: 'created', payload: { assignee: 'default', status: 'ready' } },
        { id: 2, created_at: 1010, kind: 'assigned', payload: { assignee: 'default' } }
      ],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1015, status: 'running' }],
      task: { assignee: 'default', created_at: 995, id: 't_demo', status: 'running', title: 'Demo' }
    } as KanbanTaskDetail

    const items = buildTimelineItems(detail, undefined, testKanbanText as never)

    expect(items.map(item => item.label)).toEqual([
      'Task created',
      'Assigned to default',
      'created Ready default',
      'assigned to default',
      'Agent is working now'
    ])
    expect(items.at(-1)).toMatchObject({ detail: 'default run', tone: 'current' })
    expect(items.at(-1)?.actionTrace).toBeUndefined()
  })

  it('merges worker-log fallback progress when persisted activity has only lifecycle rows', () => {
    const detail = {
      activity_timeline: [
        {
          actor: { id: 'dispatcher', type: 'system' },
          created_at: 1000,
          id: 10,
          importance: 'normal',
          source_kind: 'task_event',
          status: 'succeeded',
          summary: 'A worker picked up this task.',
          title: 'Claimed by shiburashid.local',
          type: 'task.claimed'
        }
      ],
      attachments: [],
      comments: [],
      events: [{ id: 1, created_at: 1020, kind: 'heartbeat', payload: null }],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1010, status: 'running' }],
      task: {
        assignee: 'default',
        created_at: 995,
        id: 't_demo',
        last_heartbeat_at: 1020,
        status: 'running',
        title: 'Demo'
      }
    } as KanbanTaskDetail

    const log = {
      content: [
        '  ┊ 📖 read      drawer.tsx L1-2000  0.1s',
        '  ┊ 📖 read      types.ts L1-200  0.1s',
        '  ┊ 🔎 grep      activity_timeline  0.1s'
      ].join('\n'),
      exists: true,
      size_bytes: 140,
      truncated: false
    } as WorkerLog

    const items = buildTimelineItems(detail, log, testKanbanText as never)

    expect(items.map(item => item.label)).toEqual(['Claimed by shiburashid.local', 'Agent is working now'])
    expect(items.at(-1)?.actionTrace).toEqual([
      {
        at: 1020,
        detail: 'Searched the Kanban activity timeline and worker-update code and read drawer.tsx and types.ts.',
        id: 'worker-activity-summary',
        label: 'Work updates'
      }
    ])
    expect(items.at(-1)?.children).toMatchObject([{ label: 'Worker check-ins' }])
  })

  it('keeps raw worker logs out of the timeline view', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [{ id: 1, created_at: 1000, kind: 'heartbeat', payload: null }],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1010, status: 'running' }],
      task: {
        assignee: 'default',
        created_at: 995,
        id: 't_demo',
        last_heartbeat_at: 1020,
        status: 'running',
        title: 'Demo'
      }
    } as KanbanTaskDetail

    const log = { content: 'worker output', exists: true, size_bytes: 13, truncated: false } as WorkerLog

    render(<TimelineSection detail={detail} log={log} />)

    expect(screen.queryByText('heartbeat')).toBeNull()
    expect(screen.getByText('Worker check-ins')).toBeTruthy()
    expect(screen.queryByText('Worker log')).toBeNull()
    expect(screen.queryByText('worker output')).toBeNull()
    expect(screen.queryByText('Activity · 1')).toBeNull()
    expect(screen.queryByText('Runs · 1')).toBeNull()
  })

  it('renders raw worker log fallback as chat-like trace rows', () => {
    const log = {
      content: [
        'Query: work kanban task t_demo',
        'Initializing agent for Kanban worker',
        '  ┊ 💻 $         npm run test:ui -- src/plugins/kanban/drawer.test.tsx  1.4s [exit 1]',
        '  ┊ 🔎 grep      WorkerLogSection  0.2s',
        '  ┊ review diff',
        '@@ -1,1 +1,1 @@',
        '-raw log',
        '+structured log'
      ].join('\n'),
      exists: true,
      size_bytes: 260,
      truncated: false
    } as WorkerLog

    render(<WorkerLogSection log={log} />)

    expect(screen.getByText('Worker log')).toBeTruthy()
    expect(screen.getByText('Task request received')).toBeTruthy()
    expect(screen.getByText('Started worker session')).toBeTruthy()
    expect(screen.getByText('Ran npm run test:ui -- src/plugins/kanban/drawer.test.tsx')).toBeTruthy()
    expect(screen.getByText('Searched WorkerLogSection')).toBeTruthy()
    expect(screen.getByText('Tool result')).toBeTruthy()
    expect(screen.getByText('exit 1')).toBeTruthy()
    expect(screen.getByText('@@ -1,1 +1,1 @@', { exact: false })).toBeTruthy()
  })

  it('builds durable worker trace rows from activity details before raw logs', () => {
    const detail = {
      activity_timeline: [
        {
          created_at: 1005,
          details: {
            children: [
              {
                id: 'command-vitest',
                status: 'failed',
                summary: '302ms · exit 1',
                title: 'Ran npm run test:ui -- src/plugins/kanban/drawer.test.tsx',
                type: 'agent.command'
              },
              {
                id: 'read-drawer',
                summary: 'Returned 240 of 3379 lines',
                title: 'Read apps/desktop/src/plugins/kanban/drawer.tsx',
                type: 'agent.file_read'
              }
            ],
            counts: { files: 1, tools: 3 },
            files: [{ action: 'read', path: 'apps/desktop/src/plugins/kanban/drawer.tsx' }],
            output: { redacted: true, stderr_preview: 'API_KEY=abc123\nError: failed', truncated: true },
            work_summary: 'Read drawer.tsx; ran focused Vitest coverage'
          },
          id: 10,
          source_kind: 'agent_step',
          status: 'failed',
          title: 'Inspecting relevant files',
          type: 'agent.file_inspection'
        }
      ],
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [],
      task: { created_at: 995, id: 't_demo', status: 'running', title: 'Demo' }
    } as KanbanTaskDetail
    const log = {
      content: 'raw fallback should not become primary\nTOKEN=raw-secret',
      exists: true,
      size_bytes: 80,
      truncated: true
    } as WorkerLog

    const rows = buildWorkerTraceRows(detail, log)

    expect(rows.map(row => row.label)).toEqual([
      'Explored 1 file, used 3 tools',
      'Ran npm run test:ui -- src/plugins/kanban/drawer.test.tsx',
      'Read apps/desktop/src/plugins/kanban/drawer.tsx',
      'Reviewed command output',
      'Raw log tail available'
    ])
    expect(rows[1]).toMatchObject({ duration: '302ms', status: 'exit 1', tone: 'error' })
    expect(rows[3].body?.join('\n')).toContain('API_KEY=[redacted]')
    expect(rows[4].body?.join('\n')).toContain('TOKEN=[redacted]')
  })

  it('renders projected work_trace rows when the backend supplies them', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [],
      task: { created_at: 995, id: 't_demo', status: 'done', title: 'Demo' },
      work_trace: [
        {
          duration_ms: 8000,
          id: 'thought-1',
          row_type: 'thought_span',
          status: 'succeeded',
          title: 'Thought for 8s'
        },
        {
          id: 'cmd-1',
          output: { stdout_preview: 'ok\npassword=hunter2', redacted: true, truncated: false },
          row_type: 'command',
          summary: '1.2s · exit 0',
          title: 'Ran scripts/run_tests.sh tests/hermes_cli/test_kanban_db.py'
        }
      ]
    } as KanbanTaskDetail

    render(<WorkerLogSection detail={detail} />)

    expect(screen.getByText('Thought for 8s')).toBeTruthy()
    expect(screen.getByText('8.0s')).toBeTruthy()
    expect(screen.getByText('Ran scripts/run_tests.sh tests/hermes_cli/test_kanban_db.py')).toBeTruthy()
    expect(screen.getByText('Output preview · redacted')).toBeTruthy()
    expect(screen.getByText('password=[redacted]', { exact: false })).toBeTruthy()
  })

  it('covers a representative projected worker trace fixture with concrete summaries', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [],
      task: { created_at: 995, id: 't_demo', status: 'done', title: 'Demo' },
      work_trace: [
        {
          duration_ms: 8000,
          id: 'thought-1',
          row_type: 'thought_span',
          status: 'succeeded',
          title: 'Thought for 8s'
        },
        {
          id: 'explore-1',
          row_type: 'exploration_summary',
          status: 'succeeded',
          summary: 'Read drawer.tsx; searched activity_timeline',
          title: 'Explored 2 files, used 4 tools'
        },
        {
          id: 'cmd-1',
          row_type: 'command',
          status: 'succeeded',
          summary: '302ms · exit 0',
          title: 'Ran npm run test:ui -- src/plugins/kanban/drawer.test.tsx'
        },
        {
          id: 'read-1',
          row_type: 'file_read',
          summary: 'Returned 240 of 3379 lines',
          title: 'Read apps/desktop/src/plugins/kanban/drawer.tsx'
        },
        {
          id: 'edit-1',
          row_type: 'file_edit',
          summary: 'Applied focused trace fixture coverage',
          title: 'Edited apps/desktop/src/plugins/kanban/drawer.test.tsx'
        },
        {
          failure: { message: 'Initial fixture expected generic Worker log rows' },
          id: 'recovery-1',
          row_type: 'recovery',
          status: 'failed',
          title: 'Recovered from failed assertion'
        }
      ]
    } as KanbanTaskDetail

    const log = {
      content: 'raw fallback preserved for debugging\nAuthorization: Bearer ***',
      exists: true,
      size_bytes: 120,
      truncated: false
    } as WorkerLog

    const rows = buildWorkerTraceRows(detail, log)

    expect(rows.map(row => row.label)).toEqual([
      'Thought for 8s',
      'Explored 2 files, used 4 tools',
      'Ran npm run test:ui -- src/plugins/kanban/drawer.test.tsx',
      'Read apps/desktop/src/plugins/kanban/drawer.tsx',
      'Edited apps/desktop/src/plugins/kanban/drawer.test.tsx',
      'Recovered from failed assertion',
      'Raw log available'
    ])
    expect(rows[0]).toMatchObject({ duration: '8.0s', tone: 'system' })
    expect(rows[1].detail).toBe('Read drawer.tsx; searched activity_timeline')
    expect(rows[2]).toMatchObject({ duration: '302ms', status: 'exit 0', tone: 'tool' })
    expect(rows[3].detail).toBe('Returned 240 of 3379 lines')
    expect(rows[4].detail).toBe('Applied focused trace fixture coverage')
    expect(rows[5]).toMatchObject({ detail: 'Initial fixture expected generic Worker log rows', tone: 'error' })
    expect(rows[6].body?.join('\n')).toContain('Authorization=[redacted]')
    expect(rows.map(row => row.label)).not.toContain('Terminal')
  })

  it('groups raw worker warnings and bounds long fallback output before display', () => {
    const longOutput = `stdout ${'x'.repeat(1200)}`

    const rows = buildWorkerTraceRows(undefined, {
      content: [
        longOutput,
        '⚠ API_KEY=abc123 leaked in warning',
        'Warning: cookie: session=secret should be hidden'
      ].join('\n'),
      exists: true,
      size_bytes: 1400,
      truncated: true
    } as WorkerLog)

    expect(rows.map(row => row.label)).toEqual(['Log output', '2 warnings'])
    expect(rows[0].body?.[0].endsWith('…')).toBe(true)
    expect(rows[0].body?.[0].length).toBeLessThanOrEqual(1000)
    expect(rows[1]).toMatchObject({ detail: '2 warnings grouped from the worker output.', tone: 'warning' })
    expect(rows[1].body?.join('\n')).toContain('API_KEY=[redacted]')
    expect(rows[1].body?.join('\n')).toContain('cookie=[redacted]')
  })

  it('keeps raw trace details expandable and collapsed by default', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [],
      task: { created_at: 995, id: 't_demo', status: 'done', title: 'Demo' },
      work_trace: [
        {
          id: 'cmd-1',
          output: { stdout_preview: 'short output', truncated: true },
          row_type: 'command',
          summary: '1.2s · exit 0',
          title: 'Ran focused fixture tests'
        }
      ]
    } as KanbanTaskDetail

    const log = {
      content: 'raw log detail should be hidden until expanded',
      exists: true,
      size_bytes: 60,
      truncated: true
    } as WorkerLog

    const { container } = render(<WorkerLogSection detail={detail} log={log} />)
    const disclosures = Array.from(container.querySelectorAll('details'))

    expect(screen.getByText('Ran focused fixture tests')).toBeTruthy()
    expect(screen.getByText('Output preview · truncated')).toBeTruthy()
    expect(screen.getByText('Raw log tail')).toBeTruthy()
    expect(screen.getByText('Raw log tail available')).toBeTruthy()
    expect(disclosures).toHaveLength(2)
    expect(disclosures.every(disclosure => !disclosure.open)).toBe(true)
  })

  it('keeps malformed or unknown worker log lines visible safely', () => {
    const log = {
      content: 'not a known log row\nTraceback: boom',
      exists: true,
      size_bytes: 36,
      truncated: false
    } as WorkerLog

    render(<WorkerLogSection log={log} />)

    expect(screen.getByText('Log output')).toBeTruthy()
    expect(screen.getByText('not a known log row', { exact: false })).toBeTruthy()
    expect(screen.getByText('Traceback: boom', { exact: false })).toBeTruthy()
  })

  it('renders an empty state when worker logs have not been written yet', () => {
    render(<WorkerLogSection />)

    expect(screen.getByText('Worker log')).toBeTruthy()
    expect(screen.getByText('No worker log yet.')).toBeTruthy()
  })

  it('groups worker tool log rows into one plain-language activity sentence with an age', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1010, status: 'running' }],
      task: {
        assignee: 'default',
        created_at: 995,
        id: 't_demo',
        last_heartbeat_at: 1020,
        status: 'running',
        title: 'Demo'
      }
    } as KanbanTaskDetail

    const log = {
      content: [
        '  ┊ 📖 read      drawer.tsx L1-2000  0.1s',
        '  ┊ 🔧 patch     /repo/apps/desktop/src/plugins/kanban/drawer.tsx  1.6s',
        '  ┊ 💻 $         npm run test:ui -- src/plugins/kanban/drawer.test.tsx  1.4s [exit 1]'
      ].join('\n'),
      exists: true,
      size_bytes: 180,
      truncated: false
    } as WorkerLog

    const items = buildTimelineItems(detail, log, testKanbanText as never)

    expect(items.at(-1)?.detail).not.toContain('latest action')
    expect(items.at(-1)?.actionTrace).toEqual([
      {
        at: 1020,
        detail: 'Read drawer.tsx, updated drawer.tsx, and ran the Kanban UI tests.',
        id: 'worker-activity-summary',
        label: 'Work updates'
      }
    ])
  })

  it('does not echo unknown raw worker output into current activity', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1010, status: 'running' }],
      task: {
        assignee: 'default',
        created_at: 995,
        id: 't_demo',
        last_heartbeat_at: 1020,
        status: 'running',
        title: 'Demo'
      }
    } as KanbanTaskDetail

    const log = { content: 'worker output', exists: true, size_bytes: 13, truncated: false } as WorkerLog

    const items = buildTimelineItems(detail, log, testKanbanText as never)

    expect(items.at(-1)?.actionTrace).toBeUndefined()
  })

  it('shows one grouped worker update instead of a long list of raw actions', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1010, status: 'running' }],
      task: {
        assignee: 'default',
        created_at: 995,
        id: 't_demo',
        last_heartbeat_at: 1020,
        status: 'running',
        title: 'Demo'
      }
    } as KanbanTaskDetail

    const log = {
      content: Array.from({ length: 25 }, (_, index) => `  ┊ 📖 read      file-${index + 1}.tsx  0.1s`).join('\n'),
      exists: true,
      size_bytes: 1000,
      truncated: false
    } as WorkerLog

    const items = buildTimelineItems(detail, log, testKanbanText as never)

    expect(items.some(item => item.label === 'Recent action')).toBe(false)
    expect(items.at(-1)).toMatchObject({ label: 'Agent is working now' })
    expect(items.at(-1)?.actionTrace).toEqual([
      {
        at: 1020,
        detail: 'Read file-1.tsx, file-2.tsx, file-3.tsx, file-4.tsx, and 21 more.',
        id: 'worker-activity-summary',
        label: 'Work updates'
      }
    ])
  })

  it('keeps work updates visibly before heartbeat rows after completion with an age', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1040 * 1000)

    const detail = {
      attachments: [],
      comments: [],
      events: [
        ...Array.from({ length: 12 }, (_, index) => ({
          id: index + 1,
          created_at: 1000 + index,
          kind: 'heartbeat',
          payload: null
        })),
        { id: 20, created_at: 1015, kind: 'completed', payload: null }
      ],
      links: { children: [], parents: [] },
      runs: [{ ended_at: 1030, id: 9, outcome: 'completed', profile: 'default', started_at: 990, status: 'closed' }],
      task: { completed_at: 1030, created_at: 980, id: 't_demo', status: 'done', title: 'Demo' }
    } as KanbanTaskDetail

    const log = {
      content: [
        '  ┊ 📚 skill     hermes-agent  0.1s',
        '  ┊ 👁️  vision    inspect screenshot  0.1s',
        '  ┊ 🔎 grep      timeline  0.1s',
        '  ┊ 🔧 patch     drawer.tsx  1.6s'
      ].join('\n'),
      exists: true,
      size_bytes: 180,
      truncated: false
    } as WorkerLog

    try {
      const items = buildTimelineItems(detail, log, testKanbanText as never)
      const completed = items.find(item => item.id === 'current-done')

      expect(completed?.label).toBe('Work completed')
      expect(completed?.actionTrace).toEqual([
        {
          at: 1030,
          detail:
            'Loaded Hermes guidance, reviewed the attached screenshot, searched the Kanban activity timeline and worker-update code, and updated drawer.tsx.',
          id: 'worker-activity-summary',
          label: 'Work updates'
        }
      ])

      const { container } = render(<TimelineSection detail={detail} log={log} />)
      const workUpdates = screen.getByText('Work updates')
      const checkIns = screen.getByText('Worker check-ins')

      expect(container.textContent).toContain('10 sec. ago')
      expect(screen.queryByText('heartbeat')).toBeNull()
      expect(screen.getByText('The agent stayed active through 12 routine check-ins.')).toBeTruthy()
      expect(workUpdates.compareDocumentPosition(checkIns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    } finally {
      now.mockRestore()
    }
  })

  it('adds a waiting item when a ready task has no assignee', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [],
      links: { children: [], parents: [] },
      runs: [],
      task: { created_at: 995, id: 't_demo', status: 'ready', title: 'Demo' }
    } as KanbanTaskDetail

    const items = buildTimelineItems(detail, undefined, testKanbanText as never)

    expect(items.at(-1)).toMatchObject({ detail: 'No assignee yet', label: 'Waiting in Ready', tone: 'warning' })
  })
})

describe('DependenciesSection', () => {
  it('keeps dependency layout readable beside trace-heavy task details', () => {
    const onOpen = vi.fn()

    const detail = {
      attachments: [],
      comments: [],
      events: [],
      link_details: {
        children: [{ id: 't_child123456', status: 'ready', title: 'Run focused Kanban QA' }],
        parents: [{ id: 't_parent123456', status: 'done', title: 'Implement Worker Trace summaries' }]
      },
      links: { children: ['t_child123456'], parents: ['t_parent123456'] },
      runs: [],
      task: { created_at: 995, id: 't_demo', status: 'ready', title: 'Demo' },
      work_trace: [
        {
          id: 'trace-heavy-row',
          output: { stdout_preview: 'large output hidden in worker trace', truncated: true },
          row_type: 'command',
          title: 'Ran focused Kanban drawer tests'
        }
      ]
    } as KanbanTaskDetail

    render(
      <TaskDrawerShell mode="sheet" onPaste={vi.fn()}>
        <TitleSection onSave={vi.fn()} title="Trace-heavy Kanban detail" />
        <DependenciesSection detail={detail} onOpen={onOpen} />
        <TimelineSection detail={detail} />
        <WorkerLogSection detail={detail} />
      </TaskDrawerShell>
    )

    expect(screen.getByTestId('kanban-task-detail-shell')).toBeTruthy()
    expect(screen.getByText('Trace-heavy Kanban detail')).toBeTruthy()
    expect(screen.getByText('Dependencies')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Implement Worker Trace summaries' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run focused Kanban QA' })).toBeTruthy()
    expect(screen.getByText('Timeline (2)')).toBeTruthy()
    expect(screen.getByText('Worker log')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Run focused Kanban QA' }))
    expect(onOpen).toHaveBeenCalledWith('t_child123456')
  })

  it('renders dependency titles instead of short ids and keeps ids for navigation', () => {
    const onOpen = vi.fn()

    const detail = {
      attachments: [],
      comments: [],
      events: [],
      link_details: {
        children: [{ id: 't_child123456', status: 'ready', title: 'Implement the dashboard follow-up task' }],
        parents: [{ id: 't_parent123456', status: 'done', title: 'Prepare the API contract for dependencies' }]
      },
      links: { children: ['t_child123456'], parents: ['t_parent123456'] },
      runs: [],
      task: { created_at: 995, id: 't_demo', status: 'ready', title: 'Demo' }
    } as KanbanTaskDetail

    render(<DependenciesSection detail={detail} onOpen={onOpen} />)

    expect(screen.getByRole('button', { name: 'Prepare the API contract for dependencies' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Implement the dashboard follow-up task' })).toBeTruthy()
    expect(screen.queryByText('parent')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Prepare the API contract for dependencies' }))
    expect(onOpen).toHaveBeenCalledWith('t_parent123456')
  })

  it('falls back to short ids for older detail responses without link metadata', () => {
    render(
      <DependenciesSection
        detail={
          {
            attachments: [],
            comments: [],
            events: [],
            links: { children: [], parents: ['t_parent123456'] },
            runs: [],
            task: { created_at: 995, id: 't_demo', status: 'ready', title: 'Demo' }
          } as KanbanTaskDetail
        }
        onOpen={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'parent' })).toBeTruthy()
  })
})
