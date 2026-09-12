import { cleanup, render, screen } from '@testing-library/react'
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
import { setSessionsLoading } from '@/store/session'

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
  setSessionsLoading(true)
  localStorage.clear()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('Sidebar project chrome', () => {
  it('lets the scrolling content rail occupy the full sidebar height', () => {
    const { container } = renderSidebar()
    const sidebar = container.querySelector<HTMLElement>('[data-slot="sidebar"]')
    const content = container.querySelector<HTMLElement>('[data-slot="sidebar-content"]')

    expect(container.querySelector('[data-sidebar-toolbar-spacer]')).toBeNull()
    expect(sidebar?.firstElementChild).toBe(content)
    expect(content?.className).toContain('pt-[calc(var(--titlebar-control-height,24px)+0.375rem)]')
  })

  it('renders the project overview directly without a redundant Projects header', () => {
    $projectScope.set(ALL_PROJECTS)
    $projectTreeLoading.set(false)
    setSidebarRecentsOpen(true)
    setSessionsLoading(false)
    $projectTree.set([
      {
        id: '__no_project__',
        isNoProject: true,
        label: 'Home',
        path: null,
        repos: [],
        sessionCount: 0
      },
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

    expect(screen.queryByText('Projects')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse Projects' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand Projects' })).toBeNull()
    expect(screen.getByText('Home')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull()
    expect(screen.queryByPlaceholderText(/search sessions/i)).toBeNull()
  })
})

describe('Sidebar app nav placement', () => {
  it('keeps contributed app pages out of the sidebar so projects use the space', () => {
    setKanbanNavContribution()

    renderSidebar()

    expect(screen.queryByText('Kanban')).toBeNull()
    expect(screen.queryByTitle('9 Kanban Ready tasks')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand Kanban' })).toBeNull()
  })

  it('keeps scheduled jobs out of the sidebar nav so project rows move up', () => {
    setCronJobs([
      { enabled: true, id: 'daily', name: 'Daily digest' },
      { enabled: true, id: 'weekly', name: 'Weekly review' }
    ])

    renderSidebar()

    expect(screen.queryByRole('button', { name: 'Expand Scheduled jobs' })).toBeNull()
    expect(screen.queryByText('Daily digest')).toBeNull()
    expect(mockGetCronJobRuns).not.toHaveBeenCalled()
  })
})
