import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type * as React from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import type { Contribution } from '@/contrib/types'
import { $boardSlug } from '@/plugins/kanban/api'
import { $routeTiles, openRouteTile } from '@/store/route-tiles'

import type { SidebarNavChildrenProps } from '../../routes'

import { ChatSidebar } from './index'

const mockNavContributions = vi.hoisted<Contribution[]>(() => [])

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

function renderSidebar() {
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
  $routeTiles.set([])
  localStorage.clear()
  vi.clearAllMocks()
  vi.restoreAllMocks()
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
})
