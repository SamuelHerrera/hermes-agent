import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $boardSlug, fetchBoard } from './api'
import plugin, { KanbanNavStatus, KanbanRouteTabLead } from './plugin'
import type { KanbanBoard } from './types'

vi.mock('./ui', async () => {
  const actual = await vi.importActual('./ui')

  return {
    ...actual,
    useKanban: () => ({
      col: {
        blocked: { help: '', label: 'Blocked' },
        done: { help: '', label: 'Done' },
        ready: { help: '', label: 'Ready' },
        review: { help: '', label: 'Review' },
        running: { help: '', label: 'Running' },
        scheduled: { help: '', label: 'Scheduled' },
        todo: { help: '', label: 'Todo' },
        triage: { help: '', label: 'Triage' }
      },
      countTip: (running: number, ready: number) => `${running} running / ${ready} ready`
    })
  }
})

vi.mock('./api', async () => {
  const actual = await vi.importActual('./api')

  return {
    ...actual,
    bindApi: vi.fn(() => vi.fn()),
    fetchBoard: vi.fn()
  }
})

function tasks(status: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `${status}-${i}`, status, title: `${status} ${i}` }))
}

function board(running: number, ready = 0): KanbanBoard {
  return {
    assignees: [],
    columns: [
      { name: 'running', tasks: tasks('running', running) },
      { name: 'ready', tasks: tasks('ready', ready) }
    ],
    latest_event_id: 1,
    now: 1000,
    tenants: []
  }
}

function boardWithCounts(counts: Record<string, number>): KanbanBoard {
  return {
    assignees: [],
    columns: Object.entries(counts).map(([name, count]) => ({ name, tasks: tasks(name, count) })),
    latest_event_id: 1,
    now: 1000,
    tenants: []
  }
}

function renderWithClient(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

afterEach(() => {
  $boardSlug.set('')
  vi.clearAllMocks()
})

describe('Kanban route tab loader', () => {
  it('registers a Kanban route tab lead for opened page tiles', () => {
    const contributions: Array<{ area: string; data?: unknown; id: string }> = []

    plugin.register({
      i18n: { register: vi.fn(), t: (key: string) => key },
      onDispose: vi.fn(),
      registerMany: vi.fn(entries => {
        contributions.push(...entries)

        return vi.fn()
      }),
      rest: vi.fn(),
      socket: vi.fn(() => vi.fn()),
      storage: { get: (_key: string, fallback: unknown) => fallback, remove: vi.fn(), set: vi.fn() }
    } as never)

    const route = contributions.find(c => c.area === 'routes' && c.id === 'page')?.data as
      { path?: string; tabLead?: () => React.ReactNode } | undefined

    expect(route?.path).toBe('/kanban')
    expect(route?.tabLead).toBeTypeOf('function')
  })

  it('spins while Kanban tasks are running', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board(2, 1))

    const { container } = renderWithClient(<KanbanRouteTabLead />)

    expect(await screen.findByRole('status', { name: 'Kanban tasks running' })).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(container.querySelector('.codicon-loading.codicon-modifier-spin')).toBeTruthy()
  })

  it('does not show a route tab loader when no Kanban task is running', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board(0, 3))

    const { container } = renderWithClient(<KanbanRouteTabLead />)

    await waitFor(() => expect(fetchBoard).toHaveBeenCalled())
    expect(screen.queryByRole('status', { name: 'Kanban tasks running' })).toBeNull()
    expect(container.querySelector('.codicon-loading.codicon-modifier-spin')).toBeNull()
  })
})

describe('Kanban sidebar nav counts', () => {
  it('shows each nonzero Kanban column count from the live board query', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(
      boardWithCounts({ blocked: 5, done: 7, ready: 3, review: 6, running: 4, scheduled: 2, todo: 0, triage: 1 })
    )

    renderWithClient(<KanbanNavStatus />)

    expect(await screen.findByTitle('1 Kanban Triage task')).toBeTruthy()
    expect(screen.getByTitle('2 Kanban Scheduled tasks')).toBeTruthy()
    expect(screen.getByTitle('3 Kanban Ready tasks')).toBeTruthy()
    expect(screen.getByTitle('4 Kanban Running tasks')).toBeTruthy()
    expect(screen.getByTitle('5 Kanban Blocked tasks')).toBeTruthy()
    expect(screen.getByTitle('6 Kanban Review tasks')).toBeTruthy()
    expect(screen.getByTitle('7 Kanban Done tasks')).toBeTruthy()
    expect(screen.queryByTitle('0 Kanban Todo tasks')).toBeNull()
    expect(screen.getByRole('status', { name: 'Kanban tasks running' })).toBeTruthy()
  })

  it('omits all nav count chrome when every Kanban count is zero', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(
      boardWithCounts({ blocked: 0, ready: 0, review: 0, running: 0, todo: 0, triage: 0 })
    )

    const { container } = renderWithClient(<KanbanNavStatus />)

    await waitFor(() => expect(fetchBoard).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('status', { name: 'Kanban tasks running' })).toBeNull()
  })

  it('keeps the running spinner tied only to nonzero running tasks', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board(0, 3))

    renderWithClient(<KanbanNavStatus />)

    expect(await screen.findByTitle('3 Kanban Ready tasks')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Kanban tasks running' })).toBeNull()
  })
})
