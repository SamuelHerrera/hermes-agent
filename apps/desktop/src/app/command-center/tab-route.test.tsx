import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { revealTreePane } from '@/components/pane-shell/tree/store'
import { $routeTiles, closeRouteTile } from '@/store/route-tiles'

import { COMMAND_CENTER_ROUTE } from '../routes'

import { $commandCenterTabRoute, CommandCenterTabRoute, openCommandCenterTab } from './tab-route'

vi.mock('@/components/pane-shell/tree/store', () => ({
  revealTreePane: vi.fn(),
  noteActiveTreeGroup: vi.fn()
}))

function CommandCenterProbe() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  return (
    <>
      <output data-testid="section">{params.get('section')}</output>
      <button onClick={() => setParams({ section: 'usage' })}>Usage</button>
      <button onClick={() => navigate('/skills?tab=mcp', { replace: true })}>MCP</button>
    </>
  )
}

function ShellProbe() {
  const location = useLocation()

  return (
    <>
      <output data-testid="shell-route">
        {location.pathname}
        {location.search}
      </output>
      <CommandCenterTabRoute>
        <CommandCenterProbe />
      </CommandCenterTabRoute>
    </>
  )
}

beforeEach(() => {
  $routeTiles.set([])
  $commandCenterTabRoute.set(COMMAND_CENTER_ROUTE)
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('Command Center tab routing', () => {
  it('opens a single closeable tab, remembers its section, and reopens it', () => {
    openCommandCenterTab('/command-center?section=system')
    openCommandCenterTab()

    expect($routeTiles.get()).toEqual([{ path: '/command-center', dir: 'center' }])
    expect($commandCenterTabRoute.get()).toBe('/command-center?section=system')

    closeRouteTile('/command-center')
    expect($routeTiles.get()).toEqual([])

    openCommandCenterTab()
    expect($routeTiles.get()).toEqual([{ path: '/command-center', dir: 'center' }])
    expect($commandCenterTabRoute.get()).toBe('/command-center?section=system')
  })

  it('fronts the tab instead of replacing the chat URL', () => {
    render(
      <MemoryRouter initialEntries={['/stored-chat?keep=yes']}>
        <ShellProbe />
      </MemoryRouter>
    )

    act(() => openCommandCenterTab('/command-center?section=system'))

    expect(screen.getByTestId('shell-route').textContent).toBe('/stored-chat?keep=yes')
    expect(screen.getByTestId('section').textContent).toBe('system')
    expect(revealTreePane).toHaveBeenLastCalledWith('route-tile:/command-center')
  })

  it('isolates section changes from the app route', () => {
    render(
      <MemoryRouter initialEntries={['/stored-chat']}>
        <ShellProbe />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Usage'))

    expect(screen.getByTestId('shell-route').textContent).toBe('/stored-chat')
    expect($commandCenterTabRoute.get()).toBe('/command-center?section=usage')
  })

  it('forwards links outside Command Center to the app router', () => {
    render(
      <MemoryRouter initialEntries={['/stored-chat']}>
        <ShellProbe />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('MCP'))

    expect(screen.getByTestId('shell-route').textContent).toBe('/skills?tab=mcp')
  })
})
