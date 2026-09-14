import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { watchRouteTiles } from '@/app/chat/route-tile'
import type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'
import { $terminals } from '@/app/right-sidebar/terminal/terminals'
import { CRON_ROUTE, SKILLS_ROUTE, WEBHOOKS_ROUTE } from '@/app/routes'
import { registry } from '@/contrib/registry'
import { setFileBrowserOpen } from '@/store/layout'
import { $projectTree } from '@/store/projects'
import { $routeTiles } from '@/store/route-tiles'
import { $currentCwd, $selectedStoredSessionId, $sessions, $workspaceEmptyPlaceholder } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

import { group } from '../model'
import { TreeGroup } from '../renderer/tree-group'
import { $hiddenTreePanes, $layoutTree, declareDefaultTree, registerPaneCloser, setTreePaneHidden } from '../store'

import { generateScrollGrid } from './grid'
import { ScrollWindowHeader } from './header'
import {
  $activeScrollWorkspaceId,
  $layoutSurfaceMode,
  $scrollWindowRevealRequest,
  $scrollWindowWorkspaces
} from './store'
import { ScrollWindowsMinimap } from './titlebar'
import { ScrollWindowWorkspace } from './workspace'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const project = (id: string, path: string, color: string): SidebarProjectTree => ({
  id,
  label: id,
  path,
  color,
  repos: [],
  sessionCount: 0
})

const disposers: (() => void)[] = []

beforeAll(() => {
  globalThis.ResizeObserver ??= TestResizeObserver as unknown as typeof ResizeObserver
  globalThis.CSS ??= {} as never
  globalThis.CSS.escape ??= (value: string) => value
})

beforeEach(() => {
  window.localStorage.clear()
  $layoutTree.set(null)
  $projectTree.set([project('a', '/a', '#e35d91'), project('b', '/b', '#3399cc')])
  $currentCwd.set('/a')
  $selectedStoredSessionId.set(null)
  $sessions.set([])
  $sessionTiles.set([])
  $routeTiles.set([])
  $terminals.set([])
  $hiddenTreePanes.set(new Set())
  $workspaceEmptyPlaceholder.set(false)
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
afterEach(() => {
  $routeTiles.set([])
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
})

function openContextMenu(target: HTMLElement) {
  fireEvent.pointerDown(target, { button: 2, pointerType: 'mouse' })
  fireEvent.contextMenu(target, { button: 2 })
}

describe('scroll card project headers', () => {
  it('matches minimap colors to each card, distinguishes pane types, and preserves navigation', () => {
    $terminals.set([{ id: 'one', title: 'Shell', auto: true, kind: 'user', cwd: '/b', projectId: 'b' }])
    disposers.push(
      registry.register({
        area: 'panes',
        data: { placement: 'main', uncloseable: true },
        id: 'workspace',
        render: () => <div>Chat body</div>,
        title: 'Chat'
      }),
      registry.register({
        area: 'panes',
        data: { placement: 'main' },
        id: 'terminal-instance:one',
        render: () => <div>Terminal body</div>,
        title: 'Shell'
      }),
      registry.register({
        area: 'panes',
        data: { placement: 'main' },
        id: 'terminal-instance:closed',
        render: () => <div>Closed shell</div>,
        title: 'Closed shell'
      })
    )
    declareDefaultTree(group(['workspace', 'terminal-instance:one', 'terminal-instance:closed'], { active: 'workspace', id: 'grp-main' }))
    setTreePaneHidden('terminal-instance:closed', true)
    $scrollWindowWorkspaces.set([
      {
        id: '1',
        focusedWindowId: 'workspace',
        windowIds: ['workspace', 'terminal-instance:closed', 'terminal-instance:one'],
        columns: [['workspace'], ['terminal-instance:closed'], ['terminal-instance:one']],
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

    const { getByRole, getByTestId, queryByText } = render(
      <>
        <ScrollWindowHeader data-testid="chat" windowId="workspace" />
        <ScrollWindowHeader data-testid="terminal" windowId="terminal-instance:one" />
        <ScrollWindowsMinimap />
      </>
    )

    const chat = getByRole('button', { name: 'Scroll to window 1' })
    const terminal = getByRole('button', { name: 'Scroll to window 2' })
    expect(screen.queryByRole('button', { name: 'Scroll to window 3' })).toBeNull()
    expect(chat.getAttribute('data-scroll-minimap-window')).toBe('workspace')
    expect(terminal.getAttribute('data-scroll-minimap-window')).toBe('terminal-instance:one')

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

  it('uses type icons and the tab context menu on scroll-window cards', async () => {
    disposers.push(
      registry.register({
        area: 'panes',
        data: { placement: 'main', uncloseable: true },
        id: 'workspace',
        render: () => <div>Chat body</div>,
        title: 'Chat'
      }),
      registry.register({
        area: 'panes',
        data: { placement: 'main' },
        id: 'terminal-instance:one',
        render: () => <div>Terminal body</div>,
        title: 'Shell'
      })
    )
    registerPaneCloser('workspace', () => undefined)
    declareDefaultTree(group(['workspace', 'terminal-instance:one'], { active: 'workspace', id: 'grp-main' }))

    const { container } = render(<ScrollWindowWorkspace />)

    expect(container.querySelector('[data-scroll-window="workspace"] .codicon-comment')).toBeTruthy()
    expect(container.querySelector('[data-scroll-window="terminal-instance:one"] .codicon-terminal')).toBeTruthy()

    openContextMenu(container.querySelector<HTMLElement>('[data-scroll-window="terminal-instance:one"]')!)

    expect(await screen.findByRole('menuitem', { name: /^close$/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /close others/i })).toBeTruthy()
  })

  it('keeps the global files rail visible in scroll-window mode', () => {
    disposers.push(
      registry.register({
        area: 'panes',
        data: { placement: 'left' },
        id: 'sessions',
        render: () => <div>Sessions rail</div>,
        title: 'Sessions'
      }),
      registry.register({
        area: 'panes',
        data: { placement: 'main', uncloseable: true },
        id: 'workspace',
        render: () => <div>Chat body</div>,
        title: 'Chat'
      }),
      registry.register({
        area: 'panes',
        data: { placement: 'right' },
        id: 'files',
        render: () => <div>Files rail</div>,
        title: 'Files'
      })
    )
    declareDefaultTree(group(['workspace'], { active: 'workspace', id: 'grp-main' }))
    setFileBrowserOpen(true)

    const { container } = render(<ScrollWindowWorkspace />)

    expect(screen.getByText('Files rail')).toBeTruthy()
    expect(container.querySelector('[data-scroll-window-files]')).toBeTruthy()
    expect(container.querySelector('[data-scroll-window-files] [data-scroll-window-header]')).toBeNull()
  })

  it('shows built-in page icons in tab strips and scroll-window cards', () => {
    $routeTiles.set([{ path: SKILLS_ROUTE, dir: 'center' }, { path: CRON_ROUTE, dir: 'center' }, { path: WEBHOOKS_ROUTE, dir: 'center' }])
    watchRouteTiles()

    const node = group(['route-tile:/skills', 'route-tile:/cron', 'route-tile:/webhooks'], { active: 'route-tile:/skills', id: 'grp-main' })
    declareDefaultTree(node)
    $scrollWindowWorkspaces.set([
      {
        id: '1',
        focusedWindowId: 'route-tile:/skills',
        windowIds: ['route-tile:/skills', 'route-tile:/cron', 'route-tile:/webhooks'],
        columns: [['route-tile:/skills'], ['route-tile:/cron'], ['route-tile:/webhooks']],
        scrollLeft: 0,
        scrollTop: 0,
        grid: null
      }
    ])

    const tabbed = render(<TreeGroup node={node} />)
    expect(tabbed.container.querySelector('[data-tree-tab="route-tile:/skills"] .codicon-symbol-misc')).toBeTruthy()
    expect(tabbed.container.querySelector('[data-tree-tab="route-tile:/cron"] .codicon-clockface')).toBeTruthy()
    expect(tabbed.container.querySelector('[data-tree-tab="route-tile:/webhooks"] .codicon-plug')).toBeTruthy()
    tabbed.unmount()

    const scroll = render(<ScrollWindowWorkspace />)
    expect(scroll.container.querySelector('[data-scroll-window="route-tile:/skills"] .codicon-symbol-misc')).toBeTruthy()
    expect(scroll.container.querySelector('[data-scroll-window="route-tile:/cron"] .codicon-clockface')).toBeTruthy()
    expect(scroll.container.querySelector('[data-scroll-window="route-tile:/webhooks"] .codicon-plug')).toBeTruthy()
  })
})
