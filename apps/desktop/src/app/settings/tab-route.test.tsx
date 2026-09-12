import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { revealTreePane } from '@/components/pane-shell/tree/store'
import { $routeTiles, closeRouteTile } from '@/store/route-tiles'

import { $workspaceIsPage, isOverlayView, syncWorkspaceRoute } from '../routes'
import { useOverlayRouting } from '../shell/hooks/use-overlay-routing'

import { $settingsTabRoute, openSettingsTab, SettingsTabRoute } from './tab-route'

vi.mock('@/components/pane-shell/tree/store', () => ({
  revealTreePane: vi.fn(),
  noteActiveTreeGroup: vi.fn()
}))

function SettingsProbe() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  return (
    <>
      <output data-testid="section">{params.get('tab')}</output>
      <button onClick={() => setParams({ tab: 'providers', pview: 'keys' })}>Providers</button>
      <button onClick={() => navigate('/skills?tab=mcp', { replace: true })}>MCP</button>
    </>
  )
}

function ShellProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  // Match shell ordering: workspace route sync runs before route hand-offs.
  useEffect(() => syncWorkspaceRoute(location.pathname), [location.pathname])
  useOverlayRouting()

  return (
    <>
      <output data-testid="shell-route">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate('/settings?tab=billing&bview=plans')}>Open settings</button>
      <SettingsTabRoute>
        <SettingsProbe />
      </SettingsTabRoute>
    </>
  )
}

beforeEach(() => {
  $routeTiles.set([])
  $settingsTabRoute.set('/settings')
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('Settings tab routing', () => {
  it('opens a single closeable tab, remembers its section, and reopens it', () => {
    openSettingsTab('/settings?tab=providers&pview=keys')
    openSettingsTab()
    expect($routeTiles.get()).toEqual([{ path: '/settings', dir: 'center' }])
    expect($settingsTabRoute.get()).toBe('/settings?tab=providers&pview=keys')
    closeRouteTile('/settings')
    expect($routeTiles.get()).toEqual([])
    openSettingsTab()
    expect($routeTiles.get()).toEqual([{ path: '/settings', dir: 'center' }])
    expect($settingsTabRoute.get()).toBe('/settings?tab=providers&pview=keys')
  })

  it('hands settings deep links to the tab without replacing the chat URL', () => {
    render(
      <MemoryRouter initialEntries={['/stored-chat?keep=yes']}>
        <ShellProbe />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('Open settings'))
    expect(screen.getByTestId('shell-route').textContent).toBe('/stored-chat?keep=yes')
    expect(screen.getByTestId('section').textContent).toBe('billing')
    expect($settingsTabRoute.get()).toBe('/settings?tab=billing&bview=plans')
    expect($routeTiles.get()).toEqual([{ path: '/settings', dir: 'center' }])
  })

  it('isolates section navigation and honors new deep links while mounted', () => {
    render(
      <MemoryRouter initialEntries={['/stored-chat']}>
        <ShellProbe />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('Providers'))
    expect(screen.getByTestId('shell-route').textContent).toBe('/stored-chat')
    expect($settingsTabRoute.get()).toBe('/settings?tab=providers&pview=keys')
    act(() => openSettingsTab('/settings?tab=keys&key=example'))
    expect(screen.getByTestId('section').textContent).toBe('keys')
    expect(screen.getByTestId('shell-route').textContent).toBe('/stored-chat')
  })

  it('forwards links outside settings to the app router', () => {
    render(
      <MemoryRouter initialEntries={['/stored-chat']}>
        <ShellProbe />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('MCP'))
    expect(screen.getByTestId('shell-route').textContent).toBe('/skills?tab=mcp')
  })

  it('handles a cold-start settings deep link', () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=keybinds']}>
        <ShellProbe />
      </MemoryRouter>
    )
    expect(screen.getByTestId('section').textContent).toBe('keybinds')
    expect(screen.getByTestId('shell-route').textContent).toBe('/')
    expect($routeTiles.get()).toEqual([{ path: '/settings', dir: 'center' }])
  })

  it('fronts Settings after restoring an underlying workspace page', () => {
    render(<MemoryRouter initialEntries={['/skills?tab=mcp']}><ShellProbe /></MemoryRouter>)
    fireEvent.click(screen.getByText('Open settings'))
    expect(screen.getByTestId('shell-route').textContent).toBe('/skills?tab=mcp')
    expect(revealTreePane).toHaveBeenLastCalledWith('route-tile:/settings')
  })

  it('does not classify Settings as an overlay or take over the workspace page', () => {
    expect(isOverlayView('settings')).toBe(false)
    $workspaceIsPage.set(true)
    syncWorkspaceRoute('/settings?tab=providers')
    expect($workspaceIsPage.get()).toBe(true)
    $workspaceIsPage.set(false)
  })
})
