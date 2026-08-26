import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
})
