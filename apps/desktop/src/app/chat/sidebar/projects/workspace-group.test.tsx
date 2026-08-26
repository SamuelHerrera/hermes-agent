import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'

import { SidebarWorkspaceGroup } from './workspace-group'
import type { SidebarSessionGroup } from './workspace-groups'

afterEach(cleanup)

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      profiles: {
        switchToProfile: (label: string) => `Switch to ${label}`
      },
      sidebar: {
        newSessionIn: (label: string) => `New session in ${label}`,
        noSessions: 'No sessions yet',
        projects: {
          copyPath: 'Copy path',
          menu: 'Actions',
          removeWorktree: 'Remove worktree',
          reveal: 'Reveal in file manager',
          toggle: (label: string, open: boolean) => `${open ? 'Show' : 'Hide'} ${label} sessions`
        }
      },
      statusStack: {
        coding: {
          switchFailed: (branch: string) => `Failed to switch ${branch}`
        }
      }
    }
  })
}))

vi.mock('@/store/profile', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>

  return {
    ...actual,
    newSessionInProfile: vi.fn(),
    selectProfile: vi.fn()
  }
})

vi.mock('@/store/projects', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>

  return {
    ...actual,
    switchBranchInRepo: vi.fn()
  }
})

function session(id: string): SessionInfo {
  return {
    id,
    input_tokens: 0,
    is_active: false,
    last_active: 1000,
    output_tokens: 0,
    started_at: 1000
  } as unknown as SessionInfo
}

describe('SidebarWorkspaceGroup', () => {
  it('renders every project-detail lane session without a show-more cap', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => session(`s${i + 1}`))
    const rendered: string[] = []

    const group: SidebarSessionGroup = {
      id: '/repo::branch::main',
      isMain: true,
      label: 'main',
      path: '/repo',
      sessions
    }

    render(
      <SidebarWorkspaceGroup
        group={group}
        renderRows={items => {
          rendered.push(...items.map(item => item.id))

          return items.map(item => <div key={item.id}>{item.id}</div>)
        }}
      />
    )

    expect(rendered).toEqual(sessions.map(item => item.id))
    expect(screen.getByText('s8')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull()
  })
})
