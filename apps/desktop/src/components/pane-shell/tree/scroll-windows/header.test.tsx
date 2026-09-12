import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'
import { $terminals } from '@/app/right-sidebar/terminal/terminals'
import { $projectTree } from '@/store/projects'
import { $currentCwd, $selectedStoredSessionId, $sessions } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

import { generateScrollGrid } from './grid'
import { ScrollWindowHeader } from './header'
import {
  $activeScrollWorkspaceId,
  $layoutSurfaceMode,
  $scrollWindowRevealRequest,
  $scrollWindowWorkspaces
} from './store'
import { ScrollWindowsMinimap } from './titlebar'

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
  $layoutSurfaceMode.set('scroll-windows')
  $activeScrollWorkspaceId.set('1')
  $scrollWindowRevealRequest.set(null)
  $scrollWindowWorkspaces.set([
    {
      id: '1',
      focusedWindowId: 'workspace',
      windowIds: ['workspace', 'terminal-instance:one'],
      columns: [['workspace'], ['terminal-instance:one']],
      scrollLeft: 0,
      scrollTop: 0,
      grid: generateScrollGrid({
        windowCount: 2,
        viewportWidth: 900,
        viewportHeight: 700,
        minWindowWidth: 360,
        minWindowHeight: 280,
        gap: 12
      })
    }
  ])
})
afterEach(cleanup)

describe('scroll card project headers', () => {
  it('matches minimap colors to each card, distinguishes pane types, and preserves navigation', () => {
    $terminals.set([{ id: 'one', title: 'Shell', auto: true, kind: 'user', cwd: '/b', projectId: 'b' }])

    const { getByRole, getByTestId, queryByText } = render(
      <>
        <ScrollWindowHeader data-testid="chat" windowId="workspace" />
        <ScrollWindowHeader data-testid="terminal" windowId="terminal-instance:one" />
        <ScrollWindowsMinimap />
      </>
    )

    const chat = getByRole('button', { name: 'Scroll to window 1' })
    const terminal = getByRole('button', { name: 'Scroll to window 2' })

    const assertColors = () => {
      expect(chat.style.backgroundColor).toBe(getByTestId('chat').style.backgroundColor)
      expect(terminal.style.backgroundColor).toBe(getByTestId('terminal').style.backgroundColor)
      expect(chat.style.backgroundColor).not.toBe(terminal.style.backgroundColor)
    }

    assertColors()
    expect(chat.querySelector('.codicon-comment')).not.toBeNull()
    expect(terminal.querySelector('.codicon-terminal')).not.toBeNull()
    expect(queryByText('W1')).toBeNull()
    fireEvent.click(terminal)
    expect($scrollWindowRevealRequest.get()).toBe('terminal-instance:one')
    act(() => $projectTree.set([project('a', '/a', '#22aa77'), project('b', '/b', '#bb55ee')]))
    assertColors()
  })

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
