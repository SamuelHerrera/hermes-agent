import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $layoutSurfaceMode } from '@/components/pane-shell/tree/scroll-windows'
import type { Contribution } from '@/contrib/types'
import { setCronJobs } from '@/store/cron'
import { $keepAwake } from '@/store/keep-awake'
import { $sidebarOpen, setSidebarOpen, setSidebarWidth, SIDEBAR_DEFAULT_WIDTH } from '@/store/layout'
import { $previewTabs, closeRightRail } from '@/store/preview'
import { $activeGatewayProfile, $profiles, $showAllProfiles } from '@/store/profile'
import { $projectDialog, closeProjectDialog } from '@/store/projects'

import type { StatusbarItem } from './statusbar-controls'
import { TitlebarControls } from './titlebar-controls'

const mockNavContributions = vi.hoisted<Contribution[]>(() => [])

vi.mock('@/contrib/react/use-contributions', () => ({
  useContributions: () => mockNavContributions
}))

vi.mock('@/components/pane-shell/edit-mode', () => ({
  toggleLayoutEditMode: vi.fn()
}))

vi.mock('@/components/pane-shell/tree/store', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resetLayoutTree: vi.fn()
}))

afterEach(() => {
  act(() => $layoutSurfaceMode.set('tabbed'))
  act(() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH))
  act(() => $keepAwake.set(false))
  act(() => setSidebarOpen(true))
  act(() => setCronJobs([]))
  act(() => closeRightRail())
  act(() => closeProjectDialog())
  act(() => $profiles.set([]))
  act(() => $activeGatewayProfile.set('default'))
  act(() => $showAllProfiles.set(false))
  mockNavContributions.length = 0
  cleanup()
  vi.clearAllMocks()
})

describe('TitlebarControls', () => {
  it('keeps the sidebar toggle in the titlebar when the sidebar is hidden', () => {
    render(
      <MemoryRouter>
        <TitlebarControls onOpenSettings={vi.fn()} />
      </MemoryRouter>
    )
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

    expect(screen.getByLabelText('App controls').style.top).toBe(
      'calc(var(--titlebar-controls-top, 5px) + var(--titlebar-controls-y-nudge, 0px))'
    )
  })

  it('leaves the aligned sidebar toolbar row visually transparent', () => {
    const { container } = render(
      <MemoryRouter>
        <TitlebarControls onNewSession={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    )

    expect(container.querySelector('[data-sidebar-toolbar-backdrop]')).toBeNull()
  })

  it('exposes session, browser, project and terminal as separate one-click buttons', () => {
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

    expect(screen.queryByRole('button', { name: 'Create new' })).toBeNull()
    expect(onNewSession).not.toHaveBeenCalled()
    expect(onNewTerminal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect(onNewSession).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'New browser tab' }))
    expect($previewTabs.get()).toHaveLength(1)
    expect($previewTabs.get()[0].target).toMatchObject({ kind: 'url', url: 'about:blank' })
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect($projectDialog.get()?.mode).toBe('create')
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    expect(onNewTerminal).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('supports submenu items on titlebar toolbar buttons', async () => {
    const showConsole = vi.fn()
    const openDevTools = vi.fn()

    render(
      <MemoryRouter>
        <TitlebarControls
          onNewSession={vi.fn()}
          onOpenSettings={vi.fn()}
          tools={[
            {
              icon: <span data-testid="browser-tools-icon" />,
              id: 'preview-browser-tools',
              label: 'Browser tools',
              menuItems: [
                {
                  active: false,
                  icon: <span className="codicon-output" />,
                  id: 'preview-console',
                  label: 'Show preview console',
                  onSelect: showConsole
                },
                {
                  active: false,
                  icon: <span className="codicon-debug-alt" />,
                  id: 'preview-devtools',
                  label: 'Open preview DevTools',
                  onSelect: openDevTools
                }
              ]
            }
          ]}
        />
      </MemoryRouter>
    )

    openToolbarMenu('Browser tools')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show preview console' }))

    expect(showConsole).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    openToolbarMenu('Browser tools')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Open preview DevTools' }))

    expect(openDevTools).toHaveBeenCalledOnce()
  })

  it('toggles keep-awake from the dropdown instead of the app toolbar', async () => {
    render(
      <MemoryRouter>
        <TitlebarControls onNewSession={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: /Keep computer awake/ })).toBeNull()
    openAppMenu()

    const enable = within(screen.getByRole('toolbar', { name: 'More controls' })).getByRole('button', {
      name: 'Keep computer awake: Off'
    })

    expect(enable.getAttribute('aria-pressed')).toBe('false')
    expect(enable.querySelector('.codicon-unlock')).toBeTruthy()

    fireEvent.click(enable)

    expect($keepAwake.get()).toBe(true)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    openAppMenu()

    const disable = within(screen.getByRole('toolbar', { name: 'More controls' })).getByRole('button', {
      name: 'Keep computer awake: On'
    })

    expect(disable.getAttribute('aria-pressed')).toBe('true')
    expect(disable.querySelector('.codicon-lock')).toBeTruthy()
    fireEvent.click(disable)
    expect($keepAwake.get()).toBe(false)
  })

  it('toggles scroll-window layout from the dropdown instead of the header', async () => {
    act(() => $layoutSurfaceMode.set('tabbed'))
    render(
      <MemoryRouter>
        <TitlebarControls onNewSession={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: 'Use scroll-window layout' })).toBeNull()
    openAppMenu()
    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'More controls' })).getByRole('button', {
        name: 'Use scroll-window layout'
      })
    )

    expect($layoutSurfaceMode.get()).toBe('scroll-windows')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    openAppMenu()
    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'More controls' })).getByRole('button', { name: 'Use tabbed layout' })
    )
    expect($layoutSurfaceMode.get()).toBe('tabbed')
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

    act(() => setCronJobs([{ enabled: true, id: 'daily', name: 'Daily digest' }]))
    mockNavContributions.push({
      area: 'sidebar.nav',
      data: { codicon: 'project', label: 'Kanban', openAsTile: true, path: '/kanban' },
      id: 'kanban:nav',
      source: 'plugin:kanban'
    })

    render(
      <MemoryRouter>
        <TitlebarControls
          onNewSession={vi.fn()}
          onOpenSettings={vi.fn()}
          statusbarItems={[approval, terminal, kanbanApprovalBridge, kanbanCount]}
          statusbarLeftItems={[
            commandCenter,
            {
              id: 'gateway-health',
              label: 'Gateway',
              menuContent: <span>Gateway status</span>,
              toggleLabel: 'Gateway',
              variant: 'menu'
            },
            {
              id: 'workspace-cwd',
              label: 'edu-dir-astro',
              menuItems: [
                { id: 'copy-workspace-path', label: 'Copy Path' },
                { id: 'reveal-workspace-finder', label: 'Open Containing Folder' },
                { id: 'reveal-workspace-sidebar', label: 'Reveal in filetree' }
              ],
              toggleLabel: 'Workspace',
              variant: 'menu'
            },
            {
              id: 'webhooks',
              label: 'Webhooks',
              lockedVisible: true,
              onSelect: vi.fn(),
              toggleLabel: 'Webhooks',
              variant: 'action'
            }
          ]}
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
      'Codex usage unavailable',
      'New project',
      'Show terminal',
      'New browser tab',
      'New session'
    ])
    expect(appControls.children[1]).toBe(more)
    expect(more.querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Profiles' }).querySelector('.codicon-chevron-down')).toBeNull()

    fireEvent.pointerDown(more, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(more, { button: 0, pointerType: 'mouse' })
    fireEvent.click(more)

    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Approvals', 'Views', 'Settings'])
    const controlsToolbar = screen.getByRole('toolbar', { name: 'More controls' })
    expect(within(controlsToolbar).getByRole('button', { name: 'Mute haptics' })).toBeTruthy()
    expect(within(controlsToolbar).getByRole('button', { name: 'Layout editor' })).toBeTruthy()
    expect(within(controlsToolbar).getByRole('button', { name: 'HUD mode' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Views' }), { key: 'ArrowRight' })

    expect(screen.queryByRole('menuitem', { name: 'Command Center' })).toBeNull()
    expect(await screen.findByRole('menuitem', { name: 'Approvals' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Gateway' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Workspace' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Project' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'New project' })).toBeNull()
    expect(await screen.findByRole('menuitem', { name: 'Scheduled' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Webhooks' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Capabilities' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Messaging' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Artifacts' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Kanban' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Files' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Mute haptics' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'More controls' })).toBeNull()

    expect(screen.queryByRole('menuitem', { name: /Layout editor/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'HUD mode' })).toBeNull()
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'kanban:approval-bridge' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'kanban:count' })).toBeNull()

    const labels = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(labels.indexOf('Webhooks')).toBeGreaterThan(labels.indexOf('Scheduled'))
    expect(labels.indexOf('Webhooks')).toBeLessThan(labels.indexOf('Capabilities'))

    const viewsMenu = screen.getByRole('menuitem', { name: 'Capabilities' }).closest('[role="menu"]')!
    expect(within(viewsMenu as HTMLElement).queryByRole('menuitem', { name: 'Approvals' })).toBeNull()
    expect(within(viewsMenu as HTMLElement).queryByRole('menuitem', { name: 'Settings' })).toBeNull()
  })

  it('keeps lower-priority actions menu-only when the sidebar is widened', () => {
    act(() => setSidebarWidth(320))

    render(
      <MemoryRouter>
        <TitlebarControls
          onNewSession={vi.fn()}
          onOpenSettings={vi.fn()}
          statusbarItems={[
            {
              icon: <span data-testid="approval-icon" />,
              id: 'approval-mode',
              title: 'Approval mode: Off',
              variant: 'action'
            },
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
      'Codex usage unavailable',
      'New project',
      'Show terminal',
      'New browser tab',
      'New session'
    ])
  })

  it('uses the all-profiles glyph in the titlebar when all profiles is selected', () => {
    act(() => {
      $profiles.set([
        {
          has_env: false,
          is_default: true,
          model: null,
          name: 'default',
          path: '/home/user/.hermes',
          provider: null,
          skill_count: 0
        },
        {
          has_env: false,
          is_default: false,
          model: null,
          name: 'hp-local',
          path: '/home/user/.hermes/profiles/hp-local',
          provider: null,
          skill_count: 0
        }
      ])
      $activeGatewayProfile.set('default')
      $showAllProfiles.set(true)
    })

    render(
      <MemoryRouter>
        <TitlebarControls onNewSession={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    )

    const profileButton = screen.getByRole('button', { name: 'Profiles' })

    expect(profileButton.querySelector('.codicon-layers')).toBeTruthy()
    expect(profileButton.querySelector('.codicon-home')).toBeNull()
  })

  it('does not expand the toolbar during sidebar resize previews', async () => {
    render(
      <MemoryRouter>
        <TitlebarControls
          onNewSession={vi.fn()}
          onOpenSettings={vi.fn()}
          statusbarItems={[
            {
              icon: <span data-testid="approval-icon" />,
              id: 'approval-mode',
              title: 'Approval mode: Off',
              variant: 'action'
            },
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
    expect(screen.getByRole('button', { name: 'New session' })).toBeTruthy()
  })
})

function openAppMenu() {
  const more = screen.getByRole('button', { name: 'More app actions' })
  fireEvent.pointerDown(more, { button: 0, pointerType: 'mouse' })
  fireEvent.pointerUp(more, { button: 0, pointerType: 'mouse' })
  fireEvent.click(more)
}

function openToolbarMenu(name: string) {
  const button = screen.getByRole('button', { name })
  fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' })
  fireEvent.pointerUp(button, { button: 0, pointerType: 'mouse' })
  fireEvent.click(button)
}
