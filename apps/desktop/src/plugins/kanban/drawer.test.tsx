import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KanbanCommentBody } from './comment-body'
import {
  AttachmentsSection,
  buildTimelineItems,
  CommentComposer,
  DependenciesSection,
  TaskDetailHeaderControls,
  TaskDrawerShell,
  TaskTagsSection,
  TimelineSection,
  TitleSection,
  WorkerLogSection
} from './drawer'
import type { KanbanTaskDetail, WorkerLog } from './types'

const testKanbanText = {
  activity: (count: number) => `Activity · ${count}`,
  addComment: 'Add a comment…',
  attachments: (count: number) => `Attachments (${count})`,
  close: 'Close',
  col: {
    ready: { help: '', label: 'Ready' },
    running: { help: '', label: 'Running' }
  },
  comment: 'Comment',
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
  messageWorker: 'Message the running worker…',
  noAttachments: 'No attachments',
  openAsDialog: 'Open as dialog',
  openAsSideSheet: 'Open as side sheet',
  requeueWithNote: 'Requeue with note',
  runs: (count: number) => `Runs · ${count}`,
  save: 'Save',
  send: 'Send',
  taskTitle: 'Title',
  tags: 'Tags',
  aiTagBadge: 'AI',
  aiTagTip: 'Managed automatically by AI workflow updates; you can still remove it manually.',
  noTags: 'No tags yet.',
  tagName: 'Tag name',
  addTag: 'Add tag',
  existingTags: 'Existing tags',
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
  uploadAttachment: 'Upload attachment',
  workerLog: 'Worker log',
  workerLogTail: 'Worker log · tail',
  workerLogEmpty: 'No worker log yet.'
}

vi.mock('./ui', async () => {
  const actual = await vi.importActual('./ui')

  return {
    ...actual,
    useKanban: () => testKanbanText
  }
})

afterEach(() => {
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

describe('TitleSection', () => {
  it('edits an existing task title through the same save path as the description', () => {
    const onSave = vi.fn()

    render(<TitleSection onSave={onSave} title="Original task title" />)

    expect(screen.getByText('Original task title')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))

    const input = screen.getByDisplayValue('Original task title') as HTMLInputElement
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

    expect(screen.getByText('AI:Status Ready')).toBeTruthy()
    expect(screen.getByText('AI')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag AI:Status Ready' }))

    expect(onRemove).toHaveBeenCalledWith('AI:Status Ready')
  })

  it('lets users attach an existing tag that is not already on the task', () => {
    const onAdd = vi.fn()

    render(
      <TaskTagsSection
        existingTags={[
          { id: 1, name: 'Backend', normalized_name: 'backend' },
          { id: 2, name: 'Frontend', normalized_name: 'frontend' }
        ]}
        onAdd={onAdd}
        onRemove={vi.fn()}
        pending={false}
        tags={[{ id: 1, name: 'Backend', normalized_name: 'backend' }]}
      />
    )

    expect(screen.queryByRole('button', { name: 'Add existing tag Backend' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add existing tag Frontend' }))

    expect(onAdd).toHaveBeenCalledWith('Frontend')
  })

  it('lets users create and attach a new tag name', () => {
    const onAdd = vi.fn()

    render(<TaskTagsSection existingTags={[]} onAdd={onAdd} onRemove={vi.fn()} pending={false} tags={[]} />)

    fireEvent.change(screen.getByLabelText('Tag name'), { target: { value: 'release train' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))

    expect(onAdd).toHaveBeenCalledWith('release train')
    expect((screen.getByLabelText('Tag name') as HTMLInputElement).value).toBe('')
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
    const onPasteImages = vi.fn().mockResolvedValue([{ id: 7, filename: 'clip.png', url: '/api/plugins/kanban/attachments/7' }])
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
    const onPasteImages = vi.fn().mockResolvedValue([{ id: 7, filename: 'clip.png', url: '/api/plugins/kanban/attachments/7' }])
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
      task: { assignee: 'default', created_at: 995, id: 't_demo', last_heartbeat_at: 1020, status: 'running', title: 'Demo' }
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

  it('keeps raw worker logs out of the timeline view', () => {
    const detail = {
      attachments: [],
      comments: [],
      events: [{ id: 1, created_at: 1000, kind: 'heartbeat', payload: null }],
      links: { children: [], parents: [] },
      runs: [{ id: 9, profile: 'default', started_at: 1010, status: 'running' }],
      task: { assignee: 'default', created_at: 995, id: 't_demo', last_heartbeat_at: 1020, status: 'running', title: 'Demo' }
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

  it('renders raw worker logs in their own section', () => {
    const log = { content: 'worker output', exists: true, size_bytes: 13, truncated: false } as WorkerLog

    render(<WorkerLogSection log={log} />)

    expect(screen.getByText('Worker log')).toBeTruthy()
    expect(screen.getByText('worker output')).toBeTruthy()
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
      task: { assignee: 'default', created_at: 995, id: 't_demo', last_heartbeat_at: 1020, status: 'running', title: 'Demo' }
    } as KanbanTaskDetail

    const log = {
      content: [
        "  ┊ 📖 read      drawer.tsx L1-2000  0.1s",
        "  ┊ 🔧 patch     /repo/apps/desktop/src/plugins/kanban/drawer.tsx  1.6s",
        "  ┊ 💻 $         npm run test:ui -- src/plugins/kanban/drawer.test.tsx  1.4s [exit 1]"
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
      task: { assignee: 'default', created_at: 995, id: 't_demo', last_heartbeat_at: 1020, status: 'running', title: 'Demo' }
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
      task: { assignee: 'default', created_at: 995, id: 't_demo', last_heartbeat_at: 1020, status: 'running', title: 'Demo' }
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
      { at: 1020, detail: 'Read file-1.tsx, file-2.tsx, file-3.tsx, file-4.tsx, and 21 more.', id: 'worker-activity-summary', label: 'Work updates' }
    ])
  })

  it('keeps work updates visibly before heartbeat rows after completion with an age', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1040 * 1000)

    const detail = {
      attachments: [],
      comments: [],
      events: [
        ...Array.from({ length: 12 }, (_, index) => ({ id: index + 1, created_at: 1000 + index, kind: 'heartbeat', payload: null })),
        { id: 20, created_at: 1015, kind: 'completed', payload: null }
      ],
      links: { children: [], parents: [] },
      runs: [{ ended_at: 1030, id: 9, outcome: 'completed', profile: 'default', started_at: 990, status: 'closed' }],
      task: { completed_at: 1030, created_at: 980, id: 't_demo', status: 'done', title: 'Demo' }
    } as KanbanTaskDetail

    const log = {
      content: [
        "  ┊ 📚 skill     hermes-agent  0.1s",
        "  ┊ 👁️  vision    inspect screenshot  0.1s",
        "  ┊ 🔎 grep      timeline  0.1s",
        "  ┊ 🔧 patch     drawer.tsx  1.6s"
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
          detail: 'Loaded Hermes guidance, reviewed the attached screenshot, searched the Kanban activity timeline and worker-update code, and updated drawer.tsx.',
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
