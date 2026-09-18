import { describe, expect, it } from 'vitest'

import { latestProjectSessions, orderProjectsByIds, sortProjectsForOverview } from './model'
import { NO_PROJECT_ID, type SidebarProjectTree } from './workspace-groups'

function makeProject(id: string, sessionCount: number): SidebarProjectTree {
  return {
    id,
    isAuto: true,
    label: id,
    lastActive: 0,
    path: `/repos/${id}`,
    previewSessions: [],
    repos: [],
    sessionCount
  }
}

const home = (): SidebarProjectTree => ({
  ...makeProject(NO_PROJECT_ID, 2),
  isAuto: false,
  isNoProject: true,
  path: null
})

const ids = (projects: SidebarProjectTree[]) => projects.map(project => project.id)

describe('orderProjectsByIds', () => {
  it('leaves the deterministic sort alone when nothing has been dragged', () => {
    const projects = [makeProject('a', 0), makeProject('b', 2)]

    expect(orderProjectsByIds(projects, [])).toBe(projects)
  })

  it('applies the saved manual order', () => {
    const projects = [makeProject('a', 1), makeProject('b', 1), makeProject('c', 1)]

    expect(ids(orderProjectsByIds(projects, ['c', 'a', 'b']))).toEqual(['c', 'a', 'b'])
  })

  it('keeps freshly-scanned zero-session repos below the hand-ordered list', () => {
    // The regression: a disk scan keeps finding git checkouts the user has
    // never opened in Hermes. Surfacing every unsaved id at the top buried the
    // projects they deliberately dragged into place.
    const projects = [makeProject('scanned-1', 0), makeProject('mine', 4), makeProject('scanned-2', 0)]

    expect(ids(orderProjectsByIds(projects, ['mine']))).toEqual(['mine', 'scanned-1', 'scanned-2'])
  })

  it('keeps hand-ordered positions ahead of newly active projects', () => {
    // A project you just started working in stays visible, but should not move
    // the rows the user deliberately positioned.
    const projects = [makeProject('ordered', 1), makeProject('just-started', 3)]

    expect(ids(orderProjectsByIds(projects, ['ordered']))).toEqual(['ordered', 'just-started'])
  })

  it('drops ids that are no longer present', () => {
    const projects = [makeProject('a', 1)]

    expect(ids(orderProjectsByIds(projects, ['gone', 'a']))).toEqual(['a'])
  })

  it('keeps Home on top of a hand-picked order', () => {
    const projects = [makeProject('a', 1), home(), makeProject('b', 1)]

    expect(ids(orderProjectsByIds(projects, ['b', 'a']))).toEqual([NO_PROJECT_ID, 'b', 'a'])
  })
})

describe('sortProjectsForOverview', () => {
  it('puts Home above the active project', () => {
    const active = { ...makeProject('active', 5), isAuto: false }
    const projects = [makeProject('scanned', 0), active, home()]

    expect(ids(sortProjectsForOverview(projects, 'active'))).toEqual([NO_PROJECT_ID, 'active', 'scanned'])
  })
})


describe('latestProjectSessions', () => {
  it('copies a main lane branch onto rows missing stored git metadata', () => {
    const sessions = latestProjectSessions(
      {
        ...makeProject('app', 1),
        repos: [
          {
            groups: [
              {
                id: '/repos/app::branch::sam/sidebar-branch-labels',
                isMain: true,
                label: 'sam/sidebar-branch-labels',
                path: '/repos/app',
                sessions: [{ id: 's1', last_active: 2, started_at: 2 } as never]
              }
            ],
            id: '/repos/app',
            label: 'app',
            path: '/repos/app',
            sessionCount: 1
          }
        ]
      },
      5
    )

    expect(sessions[0]?.git_branch).toBe('sam/sidebar-branch-labels')
  })
})
