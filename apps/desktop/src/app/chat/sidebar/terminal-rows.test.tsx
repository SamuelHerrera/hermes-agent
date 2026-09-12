import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { $terminalNavigation } from '@/app/right-sidebar/terminal/navigation'
import {
  $openTerminals,
  $terminals,
  ensureAgentTerminal,
  hideTerminal,
  updateTerminalReviveBuffer
} from '@/app/right-sidebar/terminal/terminals'
import { $activeTreeGroup, $layoutTree } from '@/components/pane-shell/tree/store'
import type { SessionInfo } from '@/hermes'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $activeGatewayProfile } from '@/store/profile'
import { $sessions } from '@/store/session'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'

import { NO_PROJECT_ID, type SidebarProjectTree } from './projects/workspace-groups'
import { SessionTerminalRows, terminalProjectId, TerminalSidebarRows, useTerminalProjectTree } from './terminal-rows'

const session = {
  id: 'stored-chat',
  title: 'Owner',
  profile: 'default',
  cwd: '/repo',
  source: 'desktop'
} as SessionInfo

const project: SidebarProjectTree = { id: 'project', label: 'Project', path: '/repo', repos: [], sessionCount: 0 }

beforeEach(() => {
  $terminals.set([])
  $sessions.set([session])
  $activeGatewayProfile.set('default')
  clearAllSessionStates()
})
afterEach(cleanup)

it('selects only the focused terminal, including tab switches in split groups', () => {
  const terminals = [
    { id: 'one', kind: 'user' as const, title: 'one', cwd: '/repo', auto: true },
    { id: 'two', kind: 'user' as const, title: 'two', cwd: '/repo', auto: true }
  ]

  $layoutTree.set({
    type: 'group',
    id: 'main',
    panes: ['terminal-instance:one', 'terminal-instance:two', 'workspace'],
    active: 'terminal-instance:one'
  })
  $activeTreeGroup.set('main')
  const { getByRole } = render(<TerminalSidebarRows terminals={terminals} />)
  expect(getByRole('button', { name: 'one' }).getAttribute('aria-pressed')).toBe('true')
  act(() =>
    $layoutTree.set({
      type: 'group',
      id: 'main',
      panes: ['terminal-instance:one', 'terminal-instance:two', 'workspace'],
      active: 'terminal-instance:two'
    })
  )
  expect(getByRole('button', { name: 'one' }).getAttribute('aria-pressed')).toBe('false')
  expect(getByRole('button', { name: 'two' }).getAttribute('aria-pressed')).toBe('true')
  act(() =>
    $layoutTree.set({
      type: 'group',
      id: 'main',
      panes: ['terminal-instance:one', 'terminal-instance:two', 'workspace'],
      active: 'workspace'
    })
  )
  expect(getByRole('button', { name: 'two' }).getAttribute('aria-pressed')).toBe('false')
  act(() => {
    $terminals.set(terminals)
    $layoutTree.set({
      type: 'split', id: 'split', orientation: 'row', weights: [1, 1, 1], children: [
        { type: 'group', id: 'sidebar', panes: ['sessions'], active: 'sessions' },
        { type: 'group', id: 'main', panes: ['workspace', 'terminal-instance:one'], active: 'terminal-instance:one' },
        { type: 'group', id: 'second', panes: ['terminal-instance:two'], active: 'terminal-instance:two' }
      ]
    })
    $activeTreeGroup.set('second')
  })
  expect(getByRole('button', { name: 'one' }).getAttribute('aria-pressed')).toBe('false')
  expect(getByRole('button', { name: 'two' }).getAttribute('aria-pressed')).toBe('true')
  act(() => $activeTreeGroup.set('sidebar'))
  expect(getByRole('button', { name: 'two' }).getAttribute('aria-pressed')).toBe('true')
  act(() => getByRole('button', { name: 'one' }).click())
  expect($activeTreeGroup.get()).toBe('main')
  expect(getByRole('button', { name: 'one' }).getAttribute('aria-pressed')).toBe('true')
  expect(getByRole('button', { name: 'two' }).getAttribute('aria-pressed')).toBe('false')
})

it('resolves runtime ownership to the owning chat and preserves children when tabs close', () => {
  publishSessionState('runtime', createClientSessionState(session.id))
  const id = ensureAgentTerminal('sidebar-proc', 'Build', { ownerSessionId: 'runtime', cwd: '/repo' })!

  const { container, getByRole } = render(
    <>
      <SessionTerminalRows session={session} />
      <SessionTerminalRows session={{ ...session, id: 'other' }} />
    </>
  )

  expect(container.querySelectorAll('[data-sidebar-terminal]')).toHaveLength(1)
  expect(
    container.querySelector(`[data-session-terminals="${session.id}"] [data-sidebar-terminal="${id}"]`)
  ).not.toBeNull()
  expect($openTerminals.get()).toEqual([])
  act(() => getByRole('button', { name: 'Build' }).click())
  expect($openTerminals.get().map(term => term.id)).toEqual([id])
  act(() => hideTerminal(id))
  expect($openTerminals.get()).toEqual([])
  expect(container.querySelectorAll('[data-sidebar-terminal]')).toHaveLength(1)
})

it('does not place agent terminals under the same chat id in another profile', () => {
  ensureAgentTerminal('profile-proc', 'Build', { ownerSessionId: session.id, profile: 'default', cwd: '/repo' })
  const { container } = render(<SessionTerminalRows session={{ ...session, profile: 'other' }} />)
  expect(container.querySelector('[data-sidebar-terminal]')).toBeNull()
})

it('draws branch stems for terminal children and ends only the final sibling', () => {
  ensureAgentTerminal('first', 'Build', { ownerSessionId: session.id, cwd: '/repo' })
  ensureAgentTerminal('second', 'Tests', { ownerSessionId: session.id, cwd: '/repo' })
  const { container, rerender, getByRole } = render(<SessionTerminalRows session={session} />)
  const stems = () => Array.from(container.querySelectorAll('[data-tree-stem]'), node => node.textContent)

  expect(stems()).toEqual(['├─ ', '└─ '])
  expect(getByRole('button', { name: 'Build' })).not.toBeNull()
  expect(getByRole('button', { name: 'Tests' })).not.toBeNull()
  expect(container.querySelectorAll('.codicon-output')).toHaveLength(2)

  rerender(<SessionTerminalRows hasFollowingBranches session={session} />)
  expect(stems()).toEqual(['├─ ', '├─ '])

  act(() => $terminals.set($terminals.get().slice(0, 1)))
  rerender(<SessionTerminalRows session={session} />)
  expect(stems()).toEqual(['└─ '])
})

it('leaves standalone manual terminals without chat branch stems', () => {
  const { container } = render(
    <TerminalSidebarRows terminals={[{ id: 'manual', title: 'Shell', kind: 'user', auto: true, cwd: '/repo' }]} />
  )

  expect(container.querySelector('[data-tree-stem]')).toBeNull()
  expect(container.querySelector('.codicon-terminal')).not.toBeNull()
})

it('keeps manual ownership at the original project even after the live shell changes cwd', () => {
  expect(
    terminalProjectId(
      { id: 'one', title: 'Shell', auto: true, kind: 'user', cwd: '/repo', restoreCwd: '/other', projectId: 'project' },
      [project]
    )
  ).toBe('project')
})

it('adds a Home bucket for manual terminals before the first chat exists', () => {
  $terminals.set([
    { id: 'one', kind: 'user', title: 'Shell', cwd: '/tmp', auto: true, hidden: true, projectId: NO_PROJECT_ID }
  ])
  const { result } = renderHook(() => useTerminalProjectTree([project]))
  expect(result.current.map(project => project.id)).toEqual([NO_PROJECT_ID, project.id])
})

it('preserves navigation reference identity when only terminal history or chat streaming changes', () => {
  $terminals.set([{ id: 'one', kind: 'user', title: 'Shell', cwd: '/repo', auto: true }])
  const unsubscribe = $terminalNavigation.listen(() => undefined)
  const before = $terminalNavigation.get()
  updateTerminalReviveBuffer('one', 'new output')
  publishSessionState('unrelated', createClientSessionState('elsewhere'))
  expect($terminalNavigation.get()).toBe(before)
  unsubscribe()
})
