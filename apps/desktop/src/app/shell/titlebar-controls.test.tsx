import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  cleanup()
  vi.clearAllMocks()
})

describe('TitlebarControls', () => {
  it('surfaces New project in the main titlebar app controls', () => {
    render(
      <MemoryRouter>
        <TitlebarControls onNewSession={vi.fn()} onOpenSettings={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.getByRole('button', { name: 'New project' }).querySelector('.codicon-new-folder')).toBeTruthy()
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
      title: 'Approval mode: Off',
      toggleLabel: 'Approvals',
      variant: 'action'
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
    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull()

    const more = screen.getByRole('button', { name: 'More app actions' })
    const appControls = screen.getByLabelText('App controls')

    const buttonNames = within(appControls)
      .getAllByRole('button')
      .map(button => button.getAttribute('aria-label'))

    expect(buttonNames).toEqual([
      'Hide sidebar',
      'More app actions',
      'Profiles',
      'Codex subscription usage',
      'Mute haptics',
      'Approval mode: Off',
      'Show terminal',
      'New project'
    ])
    expect(appControls.children[1]).toBe(more)
    expect(more.querySelector('svg')).toBeTruthy()

    fireEvent.pointerDown(more, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(more, { button: 0, pointerType: 'mouse' })
    fireEvent.click(more)

    expect(await screen.findByRole('menuitem', { name: 'Command Center' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Capabilities' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Messaging' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Artifacts' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'New session' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: /Layout editor/ })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'HUD mode' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Open settings' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'kanban:approval-bridge' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'kanban:count' })).toBeNull()
  })
})
