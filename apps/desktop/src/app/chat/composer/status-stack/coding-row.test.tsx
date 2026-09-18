import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesRepoStatus } from '@/global'
import { repoStatusForCwd } from '@/store/coding-status'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $projectTree } from '@/store/projects'

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

globalThis.ResizeObserver = ResizeObserverStub
Element.prototype.scrollIntoView = vi.fn()

vi.mock('@/store/coding-status', () => {
  const status = atom<HermesRepoStatus | null>({
    changed: 2,
    conflicted: 0,
    files: [],
    staged: 0,
    unstaged: 2,
    added: 12,
    ahead: 0,
    behind: 0,
    branch: 'bb/hitbox',
    defaultBranch: 'main',
    detached: false,
    removed: 3,
    untracked: 0
  })

  const worktrees = atom([])

  return {
    registerRepoStatusCwd: () => undefined,
    repoStatusForCwd: () => status,
    repoWorktreesForCwd: () => worktrees
  }
})

const { CodingStatusRow, projectOptionsForComposer } = await import('./coding-row')

const statusStore = repoStatusForCwd('/repo') as ReturnType<typeof atom<HermesRepoStatus | null>>
const loadedStatus = statusStore.get()!

describe('CodingStatusRow', () => {
  beforeEach(() => {
    statusStore.set(loadedStatus)
  })

  it('renders when an initially pending Git status resolves', () => {
    statusStore.set(null)
    const { container } = render(<CodingStatusRow repoPath="/repo" />)
    expect(container.querySelector('.coding-status-bar')).toBeNull()

    act(() => statusStore.set(loadedStatus))

    expect(screen.getByText('bb/hitbox')).toBeTruthy()
  })

  it('hides and recovers when Git status becomes unavailable again', () => {
    const { container } = render(<CodingStatusRow repoPath="/repo" />)
    expect(screen.getByText('bb/hitbox')).toBeTruthy()

    act(() => statusStore.set(null))
    expect(container.querySelector('.coding-status-bar')).toBeNull()

    act(() => statusStore.set(loadedStatus))
    expect(screen.getByText('bb/hitbox')).toBeTruthy()
  })

  afterEach(() => {
    cleanup()
    $projectTree.set([])
  })

  it('keeps branch and diff context as labels without native review buttons', () => {
    const { container } = render(<CodingStatusRow repoPath="/repo" />)

    expect(container.querySelector('.coding-status-bar')).not.toBeNull()
    expect(screen.getByText('bb/hitbox').closest('button')).toBeNull()
    expect(screen.getByText('12').closest('button')).toBeNull()
    expect(container.querySelector('.codicon-git-branch')?.closest('button')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Copy Path' })).toBeTruthy()
  })

  it('keeps the worktree path and copy affordance visible without hover', () => {
    render(<CodingStatusRow repoPath="/Users/someone/www/repo" />)

    const path = screen.getByText('~/www/repo')
    const wrapper = path.parentElement
    const copy = path.nextElementSibling

    // The path sizes to its content and the glyph is its immediate sibling, so
    // the pair reads as one unit. `flex-1` belongs to the wrapper (which holds
    // the row's slack open) — on the label it stretched the text and pushed the
    // glyph out to the kebab.
    expect(path.classList.contains('flex-1')).toBe(false)
    expect(wrapper?.classList.contains('flex-1')).toBe(true)
    expect(copy?.tagName).toBe('BUTTON')
    expect(wrapper?.classList.contains('opacity-0')).toBe(false)
    expect(copy?.classList.contains('pointer-events-none')).toBe(false)
  })

  it('copies the absolute cwd inline — checkmark feedback, no toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    clearNotifications()

    render(<CodingStatusRow repoPath="/Users/someone/www/repo" />)

    // Painted tildified, copied raw.
    expect(screen.getByText('~/www/repo')).toBeTruthy()

    const copy = screen.getByRole('button', { name: 'Copy Path' })

    fireEvent.click(copy)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/Users/someone/www/repo'))
    // Confirmation is the button turning into a checkmark, not a notification.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
    expect($notifications.get()).toHaveLength(0)
  })

  it('opens an existing branch from the branch chip', async () => {
    const onListBranches = vi.fn().mockResolvedValue([
      { checkedOut: false, isDefault: false, isRemote: false, name: 'feature/ui' },
      { checkedOut: true, isDefault: false, isRemote: false, name: 'bb/hitbox', worktreePath: '/repo' }
    ])

    const onConvertBranch = vi.fn().mockResolvedValue(undefined)

    render(
      <CodingStatusRow
        onConvertBranch={onConvertBranch}
        onListBranches={onListBranches}
        onOpenWorktree={vi.fn()}
        repoPath="/repo"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /bb\/hitbox/ }))

    await waitFor(() => expect(onListBranches).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByText('feature/ui'))

    expect(onConvertBranch).toHaveBeenCalledWith('feature/ui', undefined, false)
  })

  it('opens a new draft in the selected project from the cwd chip', async () => {
    const onOpenWorktree = vi.fn()
    $projectTree.set([
      { color: null, icon: null, id: 'p_repo', label: 'Repo', path: '/repo', repos: [], sessionCount: 0 },
      { color: null, icon: null, id: 'p_other', label: 'Other Project', path: '/other', repos: [], sessionCount: 0 }
    ])

    render(
      <CodingStatusRow
        onConvertBranch={vi.fn()}
        onListBranches={vi.fn().mockResolvedValue([])}
        onOpenWorktree={onOpenWorktree}
        repoPath="/repo"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /~?\/repo|\/repo/ }))
    fireEvent.click(await screen.findByText('Other Project'))

    expect(onOpenWorktree).toHaveBeenCalledWith('/other')
  })

  it('lists all workspace projects ordered open, remembered, then discovered and deduped by path', () => {
    const options = projectOptionsForComposer([
      {
        color: null,
        icon: null,
        id: 'auto-found',
        isAuto: true,
        label: 'Found only',
        path: '/found',
        repos: [],
        sessionCount: 0
      },
      {
        color: null,
        icon: null,
        id: 'remembered',
        label: 'Remembered',
        path: '/remembered',
        repos: [],
        sessionCount: 0
      },
      {
        color: null,
        icon: null,
        id: 'auto-duplicate',
        isAuto: true,
        label: 'upstream',
        path: '/same',
        repos: [],
        sessionCount: 0
      },
      {
        color: null,
        icon: null,
        id: 'local-duplicate',
        label: 'local',
        path: '/same/',
        repos: [],
        sessionCount: 0
      },
      {
        color: null,
        icon: null,
        id: 'open-project',
        label: 'Open Project',
        lastActive: 10,
        path: '/open',
        repos: [],
        sessionCount: 2
      }
    ])

    expect(options.map(option => option.label)).toEqual(['Open Project', 'local', 'Remembered', 'Found only'])
    expect(options.map(option => option.path)).toEqual(['/open', '/same/', '/remembered', '/found'])
  })
})
