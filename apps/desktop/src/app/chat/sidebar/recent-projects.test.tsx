import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { RecentProjects } from './recent-projects'

const history = vi.hoisted(() => ({ list: vi.fn(), forget: vi.fn(), open: vi.fn() }))
vi.mock('@/store/projects', () => ({ projectHistory: async () => history }))
vi.mock('@/store/gateway', () => ({ $gateway: atom(null) }))
vi.mock('@/store/profile', () => ({ $activeGatewayProfile: atom('default') }))
vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))
vi.mock('./projects/project-appearance', () => ({ ProjectIconGlyph: () => null }))
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: { loading: 'Loading' },
      sidebar: {
        projects: {
          recentTitle: 'Recently opened',
          recentEmpty: 'No recent projects',
          recentHint: 'Removing an entry keeps its settings.',
          removeRecent: 'Remove from recent projects',
          openRecent: 'Open project',
          recentFailed: 'Could not load recent projects'
        }
      }
    }
  })
}))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  history.list.mockResolvedValue([
    { id: 'p_saved', name: 'Saved project', primary_path: '/repo', folders: [{ path: '/repo' }] }
  ])
  history.forget.mockResolvedValue([])
  history.open.mockResolvedValue(undefined)
})
it('removes only the recent entry without opening or closing the dialog', async () => {
  const opened = vi.fn()
  render(<RecentProjects disabled={false} onOpen={opened} />)
  await screen.findByText('Saved project')
  fireEvent.click(screen.getByRole('button', { name: 'Remove from recent projects: Saved project' }))
  await screen.findByText('No recent projects')
  expect(history.forget).toHaveBeenCalledWith('p_saved')
  expect(history.open).not.toHaveBeenCalled()
  expect(opened).not.toHaveBeenCalled()
})
it('opens the selected project and closes only after success', async () => {
  const opened = vi.fn()
  render(<RecentProjects disabled={false} onOpen={opened} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Open project: Saved project' }))
  await waitFor(() => expect(opened).toHaveBeenCalledOnce())
  expect(history.open).toHaveBeenCalledWith('p_saved')
})
it('keeps history visible when removal fails', async () => {
  history.forget.mockRejectedValue(new Error('offline'))
  render(<RecentProjects disabled={false} onOpen={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove from recent projects: Saved project' }))
  await waitFor(() => expect(history.forget).toHaveBeenCalled())
  expect(screen.getByText('Saved project')).toBeTruthy()
})
