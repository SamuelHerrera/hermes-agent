import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RightSidebarPane } from '@/app/right-sidebar'
import { group, split } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree } from '@/components/pane-shell/tree/store'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $focusedCwd } from '@/store/focused-cwd'
import { $activeSessionId, $currentCwd, $selectedStoredSessionId, $sessions } from '@/store/session'
import { $sessionStates, $sessionTiles } from '@/store/session-states'
import type { SessionInfo } from '@/types/hermes'

const { browse } = vi.hoisted(() => ({ browse: vi.fn() }))
vi.mock('@/app/right-sidebar/files/use-project-tree', () => ({
  useProjectTree: (cwd: string) => {
    browse(cwd)

    return { collapseNonce: 0, data: [], effectiveCwd: cwd, openState: {}, rootLoading: false }
  }
}))

const row = (id: string, cwd: string) => ({ id, cwd }) as SessionInfo
const tilePane = (id: string) => `session-tile:${id}`

function focus(id: string) {
  $layoutTree.set(group(['workspace', tilePane('a'), tilePane('b')], { id: 'main', active: tilePane(id) }))
  $activeTreeGroup.set('main')
}

beforeEach(() => {
  $selectedStoredSessionId.set(null)
  $activeSessionId.set(null)
  $currentCwd.set('/primary')
  $sessions.set([])
  $sessionStates.set({})
  $sessionTiles.set([])
  $layoutTree.set(group(['workspace'], { id: 'main' }))
  $activeTreeGroup.set('main')
  browse.mockClear()
})

afterEach(() => {
  cleanup()
  $selectedStoredSessionId.set(null)
  $activeSessionId.set(null)
  $currentCwd.set('')
  $sessions.set([])
  $sessionStates.set({})
  $sessionTiles.set([])
  $activeTreeGroup.set(null)
  $layoutTree.set(null)
})

describe('Files focused cwd', () => {
  it('keeps cold detached and unknown tiles empty instead of inheriting the primary project', () => {
    $sessions.set([row('a', '')])
    focus('a')
    expect($focusedCwd.get()).toBe('')
    focus('b')
    expect($focusedCwd.get()).toBe('')
  })

  it('keeps the focused chat folder when interacting with the Files pane', () => {
    $sessions.set([row('a', '/project-a')])
    $layoutTree.set(
      split('row', [
        group(['workspace', tilePane('a')], { id: 'main', active: tilePane('a') }),
        group(['files'], { id: 'files' })
      ])
    )
    $activeTreeGroup.set('main')
    const unsubscribe = $focusedCwd.listen(() => {})

    try {
      expect($focusedCwd.get()).toBe('/project-a')
      $activeTreeGroup.set('files')
      expect($focusedCwd.get()).toBe('/project-a')
      $currentCwd.set('/background-primary')
      expect($focusedCwd.get()).toBe('/project-a')
    } finally {
      unsubscribe()
    }
  })

  it('uses primary draft cwd before a stored row exists', () => {
    expect($focusedCwd.get()).toBe('/primary')
    $activeSessionId.set('draft-runtime')
    $sessionStates.set({ 'draft-runtime': { ...createClientSessionState(), cwd: '/draft-worktree' } })
    expect($focusedCwd.get()).toBe('/draft-worktree')
  })

  it('does not republish unchanged cwd for streaming state or unrelated row updates', () => {
    $sessionTiles.set([{ storedSessionId: 'a', runtimeId: 'run-a' }])
    const state = { ...createClientSessionState(), storedSessionId: 'a', cwd: '/live' }
    $sessionStates.set({ 'run-a': state })
    focus('a')
    const changed = vi.fn()
    const unsubscribe = $focusedCwd.listen(changed)

    try {
      $sessionStates.set({ 'run-a': { ...state, busy: true } })
      $sessions.set([row('other', '/unrelated')])
      expect(changed).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })

  it('keeps live cwd authoritative across compression lineage rotation', () => {
    $sessions.set([{ ...row('tip', '/saved'), _lineage_root_id: 'a' }])
    $sessionTiles.set([{ storedSessionId: 'a', runtimeId: 'run-a' }])
    $sessionStates.set({ 'run-a': { ...createClientSessionState(), storedSessionId: 'tip', cwd: '/live' } })
    focus('a')
    expect($focusedCwd.get()).toBe('/live')
  })

  it('rejects the previous primary runtime while selection switches, including detached chats', () => {
    $activeSessionId.set('run-a')
    $sessionStates.set({ 'run-a': { ...createClientSessionState(), storedSessionId: 'a', cwd: '/stale-a' } })
    $sessions.set([row('b', '/project-b'), row('detached', '')])
    $selectedStoredSessionId.set('b')
    expect($focusedCwd.get()).toBe('/project-b')
    $selectedStoredSessionId.set('detached')
    expect($focusedCwd.get()).toBe('')
    $selectedStoredSessionId.set('unlisted')
    expect($focusedCwd.get()).toBe('')
    $selectedStoredSessionId.set(null)
    expect($focusedCwd.get()).toBe('/primary')
  })

  it('uses an unlisted project draft runtime and follows live cwd changes in a split', () => {
    $sessionTiles.set([{ storedSessionId: 'draft', runtimeId: 'run-draft' }])
    const state = { ...createClientSessionState(), storedSessionId: 'draft', cwd: ' /worktree ' }
    $sessionStates.set({ 'run-draft': state })
    $layoutTree.set(split('row', [group(['workspace'], { id: 'main' }), group([tilePane('draft')], { id: 'side' })]))
    $activeTreeGroup.set('side')
    expect($focusedCwd.get()).toBe('/worktree')
    $sessionStates.set({ 'run-draft': { ...state, cwd: '/relocated' } })
    expect($focusedCwd.get()).toBe('/relocated')
    $sessionStates.set({ 'run-draft': { ...state, cwd: '' } })
    expect($focusedCwd.get()).toBe('')
    $activeTreeGroup.set('main')
    expect($focusedCwd.get()).toBe('/primary')
  })

  it('follows existing cold tabs on focus changes without changing the primary cwd', async () => {
    $sessions.set([row('a', '/project-a'), row('b', '/project-b')])
    focus('a')
    render(<RightSidebarPane onActivateFile={vi.fn()} onActivateFolder={vi.fn()} />)
    await waitFor(() => expect(browse).toHaveBeenLastCalledWith('/project-a'))

    act(() => focus('b'))
    await waitFor(() => expect(browse).toHaveBeenLastCalledWith('/project-b'))
    expect($currentCwd.get()).toBe('/primary')
  })
})
