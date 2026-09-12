import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $keepAwake } from '@/store/keep-awake'
import { $sidebarOpen, setSidebarOpen, setSidebarWidth, SIDEBAR_DEFAULT_WIDTH } from '@/store/layout'
import { $projectDialog, closeProjectDialog } from '@/store/projects'

import type { StatusbarItem } from './statusbar-controls'
import { TitlebarControls } from './titlebar-controls'

vi.mock('@/components/pane-shell/edit-mode', () => ({
  toggleLayoutEditMode: vi.fn()
}))

vi.mock('@/components/pane-shell/tree/store', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resetLayoutTree: vi.fn()
}))

afterEach(() => {
  act(() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH))
  act(() => $keepAwake.set(false))
  act(() => setSidebarOpen(true))
  act(() => closeProjectDialog())
  cleanup()
  vi.clearAllMocks()
})

describe('TitlebarControls', () => {
  it('keeps the sidebar toggle in the titlebar when the sidebar is hidden', () => {
    render(<MemoryRouter><TitlebarControls onOpenSettings={vi.fn()} /></MemoryRouter>)
    const toggle = screen.getByRole('button', { name: 'Hide sidebar' })
    expect(toggle.closest('[data-titlebar-sidebar-toggle]')).toBeTruthy()
    expect(within(screen.getByLabelText('App controls')).getByRole('button', { name: 'Hide sidebar' })).toBe(toggle)
    fireEvent.click(toggle)
    expect($sidebarOpen.get()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect($sidebarOpen.get()).toBe(true)
  })
  it('places app controls on the main header row', () => {
    render(
      <MemoryRouter>
        <TitlebarControls onNewSession={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.getByLabelText('App controls').style.top).toBe('calc(var(--titlebar-controls-top, 5px) + var(--titlebar-controls-y-nudge, 0px))')
  })

  it('leaves the aligned sidebar toolbar row visually transparent', () => {
    const { container } = render(
      <MemoryRouter>
        <TitlebarControls onNewSession={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    )

    expect(container.querySelector('[data-sidebar-toolbar-backdrop]')).toBeNull()
  })

  it('combines session, project and terminal actions under the plus menu', async () => {
    const onNewSession = vi.fn()
    const onNewTerminal = vi.fn()
    render(
      <MemoryRouter>
        <TitlebarControls
          onNewSession={onNewSession}
          onOpenSettings={vi.fn()}
          statusbarItems={[{ id: 'terminal', title: 'New terminal', onSelect: onNewTerminal, variant: 'action' }]}
        />
      </MemoryRouter>
    )

    const plus = screen.getByRole('button', { name: 'Create new' })
    expect(plus.querySelector('.codicon-add')).toBeTruthy()

    for (const label of ['New session', 'New project', 'New terminal']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }

    const openMenu = () => {
      fireEvent.pointerDown(plus, { button: 0, pointerType: 'mouse' })
      fireEvent.pointerUp(plus, { button: 0, pointerType: 'mouse' })
      fireEvent.click(plus)
    }

    openMenu()
    expect(onNewSession).not.toHaveBeenCalled()
    expect(onNewTerminal).not.toHaveBeenCalled()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['New session', 'New project', 'New terminal'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'New session' }))
    expect(onNewSession).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New project' }))
    expect($projectDialog.get()?.mode).toBe('create')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New terminal' }))
    expect(onNewTerminal).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('toggles keep-awake directly from the app toolbar', () => {
    render(
      <MemoryRouter>
        <TitlebarControls onNewSession={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    )

    const enable = screen.getByRole('button', { name: 'Keep computer awake: Off' })
    expect(enable.getAttribute('aria-pressed')).toBe('false')
    expect(enable.querySelector('.codicon-unlock')).toBeTruthy()

    fireEvent.click(enable)

    expect($keepAwake.get()).toBe(true)
    const disable = screen.getByRole('button', { name: 'Keep computer awake: On' })
    expect(disable.getAttribute('aria-pressed')).toBe('true')
    expect(disable.querySelector('.codicon-lock')).toBeTruthy()
  })

  it('keeps requested app controls visible and moves the rest behind the dots menu', async () => {
    const commandCenter: StatusbarItem = {
      icon: <span data-testid="command-center-icon" />,
      id: 'command-center',
      onSelect: vi.fn(),
      title: 'Open Command Center',
      toggleLabel: 'Command Center',
      variant: 'action'
    }

    const approval: StatusbarItem = {
      icon: <span data-testid="approval-icon" />,
      id: 'approval-mode',
      menuContent: <span>Approval settings</span>,
      title: 'Approval mode: Off',
      toggleLabel: 'Approvals',
      variant: 'menu'
    }

    const terminal: StatusbarItem = {
      icon: <span data-testid="terminal-icon" />,
      id: 'terminal',
      title: 'Show terminal',
      toggleLabel: 'Terminal',
      variant: 'action'
    }

    const kanbanApprovalBridge: StatusbarItem = {
      id: 'kanban:approval-bridge',
      render: () => <span>Kanban approval bridge</span>
    }

    const kanbanCount: StatusbarItem = {
      id: 'kanban:count',
      render: () => <span>Kanban count</span>
    }

    render(
      <MemoryRouter>
        <TitlebarControls
          onNewSession={vi.fn()}
          onOpenSettings={vi.fn()}
          statusbarItems={[approval, terminal, kanbanApprovalBridge, kanbanCount]}
          statusbarLeftItems={[commandCenter]}
        />
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: 'Open Command Center' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()

    const more = screen.getByRole('button', { name: 'More app actions' })
    const appControls = screen.getByLabelText('App controls')

    const buttonNames = within(appControls)
      .getAllByRole('button')
      .map(button => button.getAttribute('aria-label'))

    expect(buttonNames).toEqual([
      'Hide sidebar',
      'More app actions',
      'Profiles',
      'Keep computer awake: Off',
      'Codex usage unavailable',
      'Mute haptics',
      'Approval mode: Off',
      'Create new'
    ])
    expect(appControls.children[1]).toBe(more)
    expect(more.querySelector('svg')).toBeTruthy()

    fireEvent.pointerDown(more, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(more, { button: 0, pointerType: 'mouse' })
    fireEvent.click(more)

    expect(await screen.findByRole('menuitem', { name: 'Command Center' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Approvals' })).toBeNull()
    expect(await screen.findByRole('menuitem', { name: 'Capabilities' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Messaging' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Artifacts' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Mute haptics' })).toBeNull()
    expect(await screen.findByRole('menuitem', { name: /Layout editor/ })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'HUD mode' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'kanban:approval-bridge' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'kanban:count' })).toBeNull()

    const menuItems = screen.getAllByRole('menuitem')
    expect(menuItems.at(-1)?.textContent).toContain('Settings')
  })

  it('keeps lower-priority actions menu-only when the sidebar is widened', () => {
    act(() => setSidebarWidth(320))

    render(
      <MemoryRouter>
        <TitlebarControls
          onNewSession={vi.fn()}
          onOpenSettings={vi.fn()}
          statusbarItems={[
            { icon: <span data-testid="approval-icon" />, id: 'approval-mode', title: 'Approval mode: Off', variant: 'action' },
            { icon: <span data-testid="terminal-icon" />, id: 'terminal', title: 'Show terminal', variant: 'action' }
          ]}
        />
      </MemoryRouter>
    )

    const buttonNames = within(screen.getByLabelText('App controls'))
      .getAllByRole('button')
      .map(button => button.getAttribute('aria-label'))

    expect(buttonNames).toEqual([
      'Hide sidebar',
      'More app actions',
      'Profiles',
      'Keep computer awake: Off',
      'Codex usage unavailable',
      'Mute haptics',
      'Approval mode: Off',
      'Create new'
    ])
  })

  it('does not expand the toolbar during sidebar resize previews', async () => {
    render(
      <MemoryRouter>
        <TitlebarControls
          onNewSession={vi.fn()}
          onOpenSettings={vi.fn()}
          statusbarItems={[
            { icon: <span data-testid="approval-icon" />, id: 'approval-mode', title: 'Approval mode: Off', variant: 'action' },
            { icon: <span data-testid="terminal-icon" />, id: 'terminal', title: 'Show terminal', variant: 'action' }
          ]}
        />
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: 'Capabilities' })).toBeNull()

    act(() => {
      window.dispatchEvent(new CustomEvent('hermes:sidebar-live-width', { detail: { width: 380 } }))
    })

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Capabilities' })).toBeNull())

    act(() => {
      window.dispatchEvent(new CustomEvent('hermes:sidebar-live-width', { detail: { width: 210 } }))
    })

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Capabilities' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Create new' })).toBeTruthy()
  })
})
