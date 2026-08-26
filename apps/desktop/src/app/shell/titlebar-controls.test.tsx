import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
        <TitlebarControls onOpenSettings={vi.fn()} />
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

    render(
      <MemoryRouter>
        <TitlebarControls
          onOpenSettings={vi.fn()}
          statusbarItems={[approval, terminal]}
          statusbarLeftItems={[commandCenter]}
        />
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: 'Open Command Center' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Approval mode: Off' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show terminal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New project' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Profiles' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /haptics/i })).toBeTruthy()

    const more = screen.getByRole('button', { name: 'More app actions' })
    fireEvent.pointerDown(more, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(more, { button: 0, pointerType: 'mouse' })
    fireEvent.click(more)

    expect(await screen.findByRole('menuitem', { name: 'Command Center' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Capabilities' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Messaging' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Artifacts' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: /Layout editor/ })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'HUD mode' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Open settings' })).toBeTruthy()
  })
})
