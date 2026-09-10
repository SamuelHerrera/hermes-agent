import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $activeTerminalId, $terminals } from '@/app/right-sidebar/terminal/terminals'

import { revealDesktopPane } from './pane-focus'

const { openReview, revealTreePane, setFileBrowserOpen, setSidebarOpen, createDefaultTerminal } = vi.hoisted(() => ({
  openReview: vi.fn(),
  revealTreePane: vi.fn(),
  setFileBrowserOpen: vi.fn(),
  setSidebarOpen: vi.fn(),
  createDefaultTerminal: vi.fn()
}))

vi.mock('@/app/right-sidebar/terminal/actions', () => ({ createDefaultTerminal }))
vi.mock('@/components/pane-shell/tree/store', () => ({ revealTreePane, $layoutTree: { get: () => null }, noteActiveTreeGroup: vi.fn() }))
vi.mock('./layout', () => ({ setFileBrowserOpen, setSidebarOpen }))
vi.mock('./review', () => ({ openReview }))

describe('revealDesktopPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    $terminals.set([])
    $activeTerminalId.set(null)
  })

  it("drives each pane's own reveal path", () => {
    revealDesktopPane('chat')
    expect(revealTreePane).toHaveBeenCalledWith('workspace')
    revealDesktopPane('files')
    expect(setFileBrowserOpen).toHaveBeenCalledWith(true)
    revealDesktopPane('review')
    expect(openReview).toHaveBeenCalledOnce()
    revealDesktopPane('sessions')
    expect(setSidebarOpen).toHaveBeenCalledWith(true)
    revealDesktopPane('terminal')
    expect(createDefaultTerminal).toHaveBeenCalledOnce()
  })

  it('reveals the existing terminal rather than creating another shell', () => {
    $terminals.set([{ id: 'one', kind: 'user', auto: true, cwd: '/repo', title: 'Shell', hidden: true }])
    revealDesktopPane('terminal')
    expect(revealTreePane).toHaveBeenCalledWith('terminal-instance:one')
    expect(createDefaultTerminal).not.toHaveBeenCalled()
    expect($terminals.get()[0].hidden).toBe(false)
  })

  it('returns false for an unknown pane and touches nothing', () => {
    expect(revealDesktopPane('nope')).toBe(false)
    expect(revealTreePane).not.toHaveBeenCalled()
  })

  it('returns true for a known pane', () => {
    expect(revealDesktopPane('terminal')).toBe(true)
  })
})
