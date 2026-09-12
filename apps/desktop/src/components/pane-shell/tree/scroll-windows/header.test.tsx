import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'
import { $terminals } from '@/app/right-sidebar/terminal/terminals'
import { $projectTree } from '@/store/projects'
import { $currentCwd, $selectedStoredSessionId, $sessions } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

import { ScrollWindowHeader } from './header'

const project = (id: string, path: string, color: string): SidebarProjectTree => ({
  id,
  label: id,
  path,
  color,
  repos: [],
  sessionCount: 0
})

beforeEach(() => {
  $projectTree.set([project('a', '/a', '#e35d91'), project('b', '/b', '#3399cc')])
  $currentCwd.set('/a')
  $selectedStoredSessionId.set(null)
  $sessions.set([])
  $sessionTiles.set([])
  $terminals.set([])
})
afterEach(cleanup)

describe('scroll card project headers', () => {
  it('tracks the primary draft project and clears the tint outside a project', () => {
    const { getByTestId } = render(<ScrollWindowHeader data-testid="header" windowId="workspace" />)
    const header = getByTestId('header')
    expect(header.getAttribute('data-scroll-window-project-color')).toBe('#e35d91')
    act(() => $currentCwd.set('/b'))
    expect(header.getAttribute('data-scroll-window-project-color')).toBe('#3399cc')
    act(() => $currentCwd.set('/elsewhere'))
    expect(header.hasAttribute('data-scroll-window-project-color')).toBe(false)
    expect(header.style.backgroundColor).toBe('')
  })

  it('keeps terminal ownership independent of the active chat and updates project colors live', () => {
    $terminals.set([{ id: 'one', title: 'Shell', auto: true, kind: 'user', cwd: '/b', projectId: 'b' }])
    const { getByTestId } = render(<ScrollWindowHeader data-testid="header" windowId="terminal-instance:one" />)
    const header = getByTestId('header')
    expect(header.getAttribute('data-scroll-window-project-color')).toBe('#3399cc')
    act(() => $currentCwd.set('/elsewhere'))
    expect(header.getAttribute('data-scroll-window-project-color')).toBe('#3399cc')
    act(() => $projectTree.set([project('b', '/b', '#7755ee')]))
    expect(header.getAttribute('data-scroll-window-project-color')).toBe('#7755ee')
  })

  it('uses a draft tile cwd without borrowing the foreground project', () => {
    $sessionTiles.set([{ storedSessionId: 'draft', workspaceCwd: '/b' }])
    const { getByTestId } = render(<ScrollWindowHeader data-testid="header" windowId="session-tile:draft" />)
    expect(getByTestId('header').getAttribute('data-scroll-window-project-color')).toBe('#3399cc')
  })
})
