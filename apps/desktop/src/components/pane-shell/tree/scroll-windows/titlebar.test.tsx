import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

afterEach(() => {
  cleanup()
})

async function setup() {
  const { registry } = await import('@/contrib/registry')
  const model = await import('../model')
  const store = await import('../store')
  const { ScrollWindowsWorkspaceChips } = await import('./titlebar')

  registry.registerMany([
    { id: 'sessions', area: 'panes', data: { placement: 'left' }, render: () => null },
    { id: 'workspace', area: 'panes', data: { placement: 'main' }, render: () => null },
    { id: 'files', area: 'panes', data: { placement: 'right' }, render: () => null }
  ])

  store.declareDefaultTree(model.split('row', [model.group(['sessions', 'files']), model.group(['workspace'])]))

  return { ScrollWindowsWorkspaceChips }
}

it('renders the files toggle after the desktop workspace buttons', async () => {
  const { ScrollWindowsWorkspaceChips } = await setup()

  render(<ScrollWindowsWorkspaceChips />)

  const labels = within(screen.getByRole('button', { name: 'Hide files' }).parentElement!).getAllByRole('button').map(button => button.getAttribute('aria-label'))

  expect(labels).toEqual([
    'Switch to workspace 1',
    'Switch to workspace 2',
    'Switch to workspace 3',
    'Switch to workspace 4',
    'Switch to workspace 5',
    'Hide files'
  ])
})

it('drives the files rail directly while scroll-window mode is active', async () => {
  const { ScrollWindowsWorkspaceChips } = await setup()
  const { $fileBrowserOpen } = await import('@/store/layout')
  const { setLayoutSurfaceMode } = await import('./store')

  setLayoutSurfaceMode('scroll-windows')
  render(<ScrollWindowsWorkspaceChips />)

  const button = screen.getByRole('button', { name: 'Show files' })
  expect($fileBrowserOpen.get()).toBe(false)

  fireEvent.click(button)

  expect($fileBrowserOpen.get()).toBe(true)
  expect(screen.getByRole('button', { name: 'Hide files' })).toBeTruthy()
})
