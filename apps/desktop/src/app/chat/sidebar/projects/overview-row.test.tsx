import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'
import { $sidebarRowMeta } from '@/store/layout'

import { ProjectDetailHeaderRow, ProjectOverviewRow } from './overview-row'
import type { SidebarProjectTree } from './workspace-groups'

const workspaceNodeOpen = vi.hoisted(() => ({ value: false }))

afterEach(() => {
  cleanup()
  act(() => $sidebarRowMeta.set(['preview', 'updated']))
  workspaceNodeOpen.value = false
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        newSessionIn: (label: string) => `New session in ${label}`,
        projects: {
          enter: (label: string) => `Enter ${label}`,
          startWork: 'New worktree',
          reorder: (label: string) => `Reorder ${label}`,
          toggle: (label: string, open: boolean) => `${open ? 'Show' : 'Hide'} ${label} sessions`
        }
      }
    }
  })
}))

vi.mock('@/store/coding-status', () => ({
  openWorktreeDialog: vi.fn()
}))

vi.mock('@/store/projects', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>

  return {
    ...actual,
    $homeProjectAppearances: {
      get: () => ({}),
      listen: () => () => {},
      subscribe: (fn: (v: Record<string, unknown>) => void) => {
        fn({})

        return () => {}
      }
    },
    homeProjectAppearanceForProfile: () => ({ color: null, icon: null })
  }
})

vi.mock('./model', () => ({
  PROJECT_OVERVIEW_SESSION_LIMIT: 5_000,
  latestProjectSessions: () => [],
  useWorkspaceNodeOpen: () => [workspaceNodeOpen.value, vi.fn()]
}))

// ProjectMenu (the kebab) has its own dedicated test file — stub it here so
// this file only exercises overview-row's own Tip usage (the disclosure
// toggle) plus the WorkspaceAddButton wiring. ProjectContextMenu (the row's
// right-click wrapper) is stubbed as a pass-through so the row still renders.
vi.mock('./project-menu', () => ({
  ProjectContextMenu: ({ children }: { children: ReactNode }) => children,
  ProjectMenu: () => <button aria-label="Actions" type="button" />
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

  it('uses full-row hover chrome and nav-sized lead icons in the flattened project list', () => {
    const { container } = render(<ProjectOverviewRow project={project} reorderable />)
    const row = container.querySelector('[data-sessions-project="p1"] > div')
    const lead = container.querySelector('[data-sessions-project="p1"] [data-sidebar-group-primary] > span')
    const label = screen.getByText('Test D')

    expect(row?.className).toContain('hover:bg-')
    expect(lead?.className).toContain('size-4')
    expect(label.className).toContain('group-hover/workspace:text-foreground')
    expect(label.className).not.toContain('underline')
  })

  it('keeps project actions visible in plus-then-menu order', () => {
    const { container } = render(<ProjectOverviewRow onNewSession={vi.fn()} project={project} />)
    const secondary = container.querySelector('[data-sidebar-group-secondary]')

    const actionLabels = Array.from(secondary?.querySelectorAll('button') ?? []).map(button =>
      button.getAttribute('aria-label')
    )

    expect(actionLabels).toEqual(['New session in Test D', 'Actions'])
  })

  it('shows explicit chat, child/subagent, running, archived, and token labels on the project metadata row', () => {
    act(() => $sidebarRowMeta.set(['tokens']))

    const { container } = render(
      <ProjectOverviewRow
        project={{
          ...project,
          archivedSessionCount: 4,
          chatSessionCount: 7,
          childSessionCount: 6,
          runningSessionCount: 2,
          sessionCount: 13,
          totalTokens: 1_300
        }}
      />
    )

    const secondary = container.querySelector('[data-sidebar-group-secondary]')
    const runningCount = container.querySelector('[data-project-running-count]')
    const chatCount = container.querySelector('[data-project-chat-count]')
    const childCount = container.querySelector('[data-project-child-count]')
    const archivedCount = container.querySelector('[data-project-archived-count]')

    expect(secondary?.contains(runningCount)).toBe(true)
    expect(secondary?.contains(chatCount)).toBe(true)
    expect(secondary?.contains(childCount)).toBe(true)
    expect(secondary?.contains(archivedCount)).toBe(true)
    expect(runningCount?.textContent).toContain('Run')
    expect(runningCount?.textContent).toContain('2')
    expect(runningCount?.querySelector('.codicon-sync')).toBeTruthy()
    expect(chatCount?.textContent).toContain('Chats')
    expect(chatCount?.textContent).toContain('7')
    expect(chatCount?.querySelector('.codicon-comment-discussion')).toBeTruthy()
    expect(childCount?.textContent).toContain('Sub')
    expect(childCount?.textContent).toContain('6')
    expect(childCount?.querySelector('.codicon-robot')).toBeTruthy()
    expect(archivedCount?.textContent).toContain('Arch')
    expect(archivedCount?.textContent).toContain('4')
    expect(archivedCount?.querySelector('.codicon-archive')).toBeTruthy()
    expect(secondary?.querySelector('[data-project-token-count]')?.textContent).toContain('Tok')
    expect(secondary?.querySelector('[data-project-token-count]')?.textContent).toContain('1.3k')
  })

  it('keeps zero running and child/subagent categories visible instead of hiding the split', () => {
    const { container } = render(
      <ProjectOverviewRow project={{ ...project, archivedSessionCount: 0, chatSessionCount: 2, childSessionCount: 0, runningSessionCount: 0 }} />
    )

    expect(container.querySelector('[data-project-running-count]')?.textContent).toContain('Run0')
    expect(container.querySelector('[data-project-child-count]')?.textContent).toContain('Sub0')
  })

  it('does not cap overview rows before rendering the project body', () => {
    workspaceNodeOpen.value = true

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

  it('hides running preview sessions when collapsed', () => {
    render(
      <ProjectOverviewRow
        previewSessions={[{ id: 'running-chat', running: true } as unknown as SessionInfo]}
        project={project}
        renderRows={sessions => sessions.map(session => <div key={session.id}>{session.id}</div>)}
      />
    )

    expect(screen.queryByText('running-chat')).toBeNull()
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

  it('renders the project detail header with the chosen project image/icon and two-row metadata', () => {
    const imageIcon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" />'

    const { container } = render(
      <ProjectDetailHeaderRow
        activeProjectId="p1"
        onNewSession={vi.fn()}
        project={{
          ...project,
          archivedSessionCount: 1,
          chatSessionCount: 2,
          childSessionCount: 3,
          icon: imageIcon,
          path: '/repo',
          runningSessionCount: 1,
          sessionCount: 5,
          totalTokens: 900
        }}
      />
    )

    const primary = container.querySelector('[data-sidebar-group-primary]')
    const secondary = container.querySelector('[data-sidebar-group-secondary]')

    expect(container.querySelector('[data-sessions-project-detail-header] img')).toBeTruthy()
    expect(primary?.textContent).toContain('Test D')
    expect(secondary?.querySelector('[data-project-running-count]')?.textContent).toContain('Run')
    expect(secondary?.querySelector('[data-project-running-count]')?.textContent).toContain('1')
    expect(secondary?.querySelector('[data-project-chat-count]')?.textContent).toContain('Chats')
    expect(secondary?.querySelector('[data-project-chat-count]')?.textContent).toContain('2')
    expect(secondary?.querySelector('[data-project-child-count]')?.textContent).toContain('Sub')
    expect(secondary?.querySelector('[data-project-child-count]')?.textContent).toContain('3')
    expect(secondary?.querySelector('[data-project-archived-count]')?.textContent).toContain('Arch')
    expect(secondary?.querySelector('[data-project-archived-count]')?.textContent).toContain('1')
  })

  it('keeps detail header actions visible in worktree, new-session, menu order without show-projects', () => {
    const { container } = render(
      <ProjectDetailHeaderRow onNewSession={vi.fn()} project={{ ...project, path: '/repo', sessionCount: 0 }} />
    )

    const secondary = container.querySelector('[data-sidebar-group-secondary]')

    const actionLabels = Array.from(secondary?.querySelectorAll('button') ?? []).map(button =>
      button.getAttribute('aria-label')
    )

    expect(actionLabels).toEqual(['New worktree', 'New session in Test D', 'Actions'])
    expect(container.querySelector('.codicon-list-unordered')).toBeNull()
  })
})
