import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'
import { $sidebarRowMeta } from '@/store/layout'

import { ProjectOverviewRow } from './overview-row'
import type { SidebarProjectTree } from './workspace-groups'

afterEach(() => {
  cleanup()
  act(() => $sidebarRowMeta.set(['preview', 'updated']))
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        newSessionIn: (label: string) => `New session in ${label}`,
        projects: {
          enter: (label: string) => `Enter ${label}`,
          reorder: (label: string) => `Reorder ${label}`,
          toggle: (label: string, open: boolean) => `${open ? 'Show' : 'Hide'} ${label} sessions`
        }
      }
    }
  })
}))

vi.mock('./model', () => ({
  PROJECT_OVERVIEW_SESSION_LIMIT: 5_000,
  latestProjectSessions: () => [],
  useWorkspaceNodeOpen: () => [false, vi.fn()]
}))

// ProjectMenu (the kebab) has its own dedicated test file — stub it here so
// this file only exercises overview-row's own Tip usage (the disclosure
// toggle) plus the WorkspaceAddButton wiring. ProjectContextMenu (the row's
// right-click wrapper) is stubbed as a pass-through so the row still renders.
vi.mock('./project-menu', () => ({
  ProjectContextMenu: ({ children }: { children: ReactNode }) => children,
  ProjectMenu: () => null
}))

const project = { id: 'p1', label: 'Test D' } as unknown as SidebarProjectTree

const tipTrigger = (el: HTMLElement) => el.closest('[data-slot="tooltip-trigger"]')

describe('ProjectOverviewRow', () => {
  it('wraps the "new session" add button in a Tip with the project-scoped label', () => {
    render(<ProjectOverviewRow onNewSession={vi.fn()} project={project} />)

    const button = screen.getByRole('button', { name: 'New session in Test D' })
    expect(tipTrigger(button)).toBeTruthy()
  })

  it('wraps the disclosure toggle in a Tip when there are preview sessions', () => {
    render(
      <ProjectOverviewRow
        previewSessions={[{ id: 's1' } as unknown as SessionInfo]}
        project={project}
        renderRows={() => null}
      />
    )

    // Collapsed by default, so the disclosure offers to show the sessions.
    const button = screen.getByRole('button', { name: 'Show Test D sessions' })
    expect(tipTrigger(button)).toBeTruthy()
  })

  it('puts the disclosure on the primary row and project tokens plus other actions on the second row', () => {
    act(() => $sidebarRowMeta.set(['tokens']))

    const { container } = render(
      <ProjectOverviewRow
        onNewSession={vi.fn()}
        previewSessions={[{ id: 's1' } as unknown as SessionInfo]}
        project={{ ...project, totalTokens: 1_300 }}
        renderRows={() => null}
      />
    )

    const primary = container.querySelector('[data-sidebar-group-primary]')
    const secondary = container.querySelector('[data-sidebar-group-secondary]')
    const toggle = screen.getByRole('button', { name: 'Show Test D sessions' })
    const add = screen.getByRole('button', { name: 'New session in Test D' })
    const tokens = screen.getByText('1.3k')

    expect(primary?.contains(toggle)).toBe(true)
    expect(primary?.contains(tokens)).toBe(false)
    expect(secondary?.contains(tokens)).toBe(true)
    expect(secondary?.contains(add)).toBe(true)
  })

  it('does not cap overview rows before rendering the project body', () => {
    render(
      <ProjectOverviewRow
        previewSessions={[
          { id: 'one', running: true },
          { id: 'two', running: true },
          { id: 'three', running: true },
          { id: 'four', running: true }
        ] as unknown as SessionInfo[]}
        project={project}
        renderRows={sessions => sessions.map(session => <div key={session.id}>{session.id}</div>)}
      />
    )

    expect(screen.getByText('one')).toBeTruthy()
    expect(screen.getByText('two')).toBeTruthy()
    expect(screen.getByText('three')).toBeTruthy()
    expect(screen.getByText('four')).toBeTruthy()
  })

  it('does not render the disclosure toggle when there is nothing to preview', () => {
    render(<ProjectOverviewRow project={project} />)

    expect(screen.queryByRole('button', { name: 'Show Test D sessions' })).toBeNull()
  })

  it('offers the "new session" add button on Home, which starts one with no folder', () => {
    const home = {
      id: '__no_project__',
      isNoProject: true,
      label: 'Home',
      path: null
    } as unknown as SidebarProjectTree

    const onNewSession = vi.fn()

    render(<ProjectOverviewRow onNewSession={onNewSession} project={home} />)
    fireEvent.click(screen.getByRole('button', { name: 'New session in Home' }))

    expect(onNewSession).toHaveBeenCalledWith(null)
  })

  it('tags the row with data-sessions-project so a skin can target one project', () => {
    const { container } = render(<ProjectOverviewRow project={project} />)

    expect(container.querySelector('[data-sessions-project="p1"]')).toBeTruthy()
  })
})
