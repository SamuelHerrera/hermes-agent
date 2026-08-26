import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as React from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import type { Contribution } from '@/contrib/types'
import { $boardSlug } from '@/plugins/kanban/api'
import { setCronJobs } from '@/store/cron'
import { setSidebarAgentsGrouped, setSidebarOrdering, setSidebarRecentsOpen } from '@/store/layout'
import { $projectScope, $projectTree, $projectTreeLoading, ALL_PROJECTS } from '@/store/projects'
import { $routeTiles, openRouteTile } from '@/store/route-tiles'

import type { SidebarNavChildrenProps } from '../../routes'

import { ChatSidebar } from './index'

const mockNavContributions = vi.hoisted<Contribution[]>(() => [])
const mockGetCronJobRuns = vi.hoisted(() => vi.fn())

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCronJobRuns: mockGetCronJobRuns
}))

vi.mock('@/contrib/react/use-contributions', () => ({
  useContributions: () => mockNavContributions
}))

vi.mock('@/components/pane-shell/tree/store', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  noteActiveTreeGroup: vi.fn(),
  revealTreePane: vi.fn()
}))

function KanbanMainCounts() {
  return (
    <span>
      <span title="9 Kanban Ready tasks">9</span>
      <span title="4 Kanban Running tasks">4</span>
    </span>
  )
}

function DefaultDashboardCounts() {
  return (
    <span>
      <span title="2 Kanban Ready tasks">2</span>
      <span title="1 Kanban Running task">1</span>
    </span>
  )
}

function PersonalDashboardCounts() {
  return <span title="3 Kanban Blocked tasks">3</span>
}

function KanbanTestDashboards({ renderItem }: SidebarNavChildrenProps) {
  return (
    <>
      {renderItem({
        active: $boardSlug.get() === '',
        adornment: DefaultDashboardCounts,
        id: 'kanban-board-default',
        label: 'Default',
        onSelect: () => {
          $boardSlug.set('')
          openRouteTile('/kanban', 'center')
        }
      })}
      {renderItem({
        active: $boardSlug.get() === 'personal',
        adornment: PersonalDashboardCounts,
        id: 'kanban-board-personal',
        label: 'Personal',
        onSelect: () => {
          $boardSlug.set('personal')
          openRouteTile('/kanban', 'center')
        }
      })}
    </>
  )
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof ChatSidebar>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SidebarProvider>
        <ChatSidebar
          currentView="chat"
          onArchiveSession={vi.fn()}
          onBranchSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onLoadMoreSessions={vi.fn()}
          onManageCronJob={vi.fn()}
          onNavigate={item => {
            if (item.route) {
              openRouteTile(item.route, 'center')
            }
          }}
          onNewSessionInWorkspace={vi.fn()}
          onNewSessionSplit={vi.fn()}
          onOpenSessionTab={vi.fn()}
          onResumeSession={vi.fn()}
          {...overrides}
        />
      </SidebarProvider>
    </MemoryRouter>
  )
}

function setKanbanNavContribution() {
  mockNavContributions.splice(0, mockNavContributions.length, {
    area: 'sidebar.nav',
    data: {
      children: KanbanTestDashboards,
      codicon: 'project',
      label: 'Kanban',
      openAsTile: true,
      path: '/kanban'
    },
    id: 'kanban:nav',
    render: () => <KanbanMainCounts />,
    source: 'plugin:kanban'
  } satisfies Contribution)
}

afterEach(() => {
  cleanup()
  mockNavContributions.length = 0
  $boardSlug.set('')
  $projectScope.set(ALL_PROJECTS)
  $projectTree.set([])
  $projectTreeLoading.set(false)
  $routeTiles.set([])
  setCronJobs([])
  setSidebarAgentsGrouped(true)
  setSidebarOrdering('updated')
  setSidebarRecentsOpen(true)
  localStorage.clear()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('Sidebar project chrome', () => {
  it('defaults to the project view with a nav-like collapse control and no search or filter menu', () => {
    $projectScope.set(ALL_PROJECTS)
    $projectTreeLoading.set(false)
    setSidebarRecentsOpen(true)
    $projectTree.set([
      {
        id: 'p1',
        label: 'Alpha',
        path: '/repo/alpha',
        repos: [
          {
            groups: [
              {
                id: '/repo/alpha::branch::main',
                label: 'main',
                path: '/repo/alpha',
                sessions: [{ id: 'alpha-session', started_at: 1, last_active: 1 } as never]
              }
            ],
            id: '/repo/alpha',
            label: 'alpha',
            path: '/repo/alpha',
            sessionCount: 1
          }
        ],
        sessionCount: 1
      }
    ])

    renderSidebar()

    expect(screen.getByText('Projects')).toBeTruthy()
    const projectLabelButton = screen.getByText('Projects').closest('button')
    const projectIcon = projectLabelButton?.querySelector('.codicon-root-folder')
    expect(projectIcon).toBeTruthy()
    expect(projectIcon?.className).toContain('leading-none')
    expect(projectLabelButton?.className).toContain('text-[0.8125rem]')
    expect(projectLabelButton?.className).toContain('hover:bg-')
    expect(projectLabelButton?.parentElement?.className).not.toContain('hover:bg-')
    expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull()
    expect(screen.queryByPlaceholderText(/search sessions/i)).toBeNull()

    const collapse = screen.getByRole('button', { name: 'Collapse Projects' })
    expect(collapse.className).toContain('hover:bg-')
    expect(collapse.querySelector('.codicon-chevron-down')).toBeTruthy()

    fireEvent.click(collapse)

    expect(screen.getByRole('button', { name: 'Expand Projects' }).querySelector('.codicon-chevron-right')).toBeTruthy()
  })
})

describe('Kanban sidebar dropdown behavior', () => {
  it('hides the expanded parent count, shows dashboard counts, and reuses the same Kanban tab', () => {
    setKanbanNavContribution()

    renderSidebar()

    expect(screen.getByTitle('9 Kanban Ready tasks')).toBeTruthy()
    expect(screen.getByTitle('4 Kanban Running tasks')).toBeTruthy()

    const kanbanButton = screen.getByText('Kanban').closest('button')
    expect(kanbanButton).toBeTruthy()

    fireEvent.click(kanbanButton!)
    fireEvent.click(kanbanButton!)

    expect($routeTiles.get()).toEqual([{ dir: 'center', path: '/kanban' }])

    const expandButton = screen.getByRole('button', { name: 'Expand Kanban' })
    const chevron = expandButton.querySelector('.codicon-chevron-right')
    expect(chevron?.className).toContain('-translate-y-px')
    expect(chevron?.className).toContain('leading-none')

    fireEvent.click(expandButton)

    expect(screen.queryByTitle('9 Kanban Ready tasks')).toBeNull()
    expect(screen.queryByTitle('4 Kanban Running tasks')).toBeNull()
    expect(screen.getByText('Default')).toBeTruthy()
    expect(screen.getByTitle('2 Kanban Ready tasks')).toBeTruthy()
    expect(screen.getByTitle('1 Kanban Running task')).toBeTruthy()
    expect(screen.getByTitle('3 Kanban Blocked tasks')).toBeTruthy()

    fireEvent.click(screen.getByText('Personal'))
    fireEvent.click(screen.getByText('Personal'))

    expect($boardSlug.get()).toBe('personal')
    expect($routeTiles.get()).toEqual([{ dir: 'center', path: '/kanban' }])
  })

  it('keeps cron executions behind each job disclosure and opens runs as tabs without refetching on selection', async () => {
    const onManageCronJob = vi.fn()
    const onOpenSessionTab = vi.fn()
    mockGetCronJobRuns.mockResolvedValue([
      { id: 'run-1', last_active: 1_700_000_000, title: 'First run' },
      { id: 'run-2', last_active: 1_700_000_060, title: 'Second run' }
    ])
    setCronJobs([
      { enabled: true, id: 'daily', name: 'Daily digest' },
      { enabled: true, id: 'weekly', name: 'Weekly review' }
    ])

    renderSidebar({ onManageCronJob, onOpenSessionTab })

    fireEvent.click(screen.getByRole('button', { name: 'Expand Scheduled jobs' }))

    expect(screen.getByText('Daily digest')).toBeTruthy()
    expect(screen.queryByText('First run')).toBeNull()
    expect(mockGetCronJobRuns).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Expand executions for Daily digest' }))

    await waitFor(() => expect(screen.getAllByText(/Nov 14/).length).toBe(2))
    expect(mockGetCronJobRuns).toHaveBeenCalledTimes(1)
    expect(mockGetCronJobRuns).toHaveBeenCalledWith('daily', 5)

    fireEvent.click(screen.getAllByText(/Nov 14/)[0])

    expect(onOpenSessionTab).toHaveBeenCalledWith('run-1')
    expect(mockGetCronJobRuns).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Daily digest'))
    expect(onManageCronJob).toHaveBeenCalledWith('daily')
  })
})
