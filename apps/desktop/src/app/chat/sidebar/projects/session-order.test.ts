import { beforeEach, expect, it } from 'vitest'

import type { SessionInfo } from '@/hermes'

import { $projectSessionOrders, orderProjectSessions, saveProjectSessionOrder } from './session-order'

const session = (id: string, started_at: number, last_active = started_at) =>
  ({ id, started_at, last_active }) as SessionInfo

const ids = (items: SessionInfo[]) => items.map(item => item.id)
beforeEach(() => $projectSessionOrders.set({}))

it('retains the default order until dragged, then ignores activity updates', () => {
  const items = [session('a', 30), session('b', 20), session('c', 10)]
  expect(orderProjectSessions(items)).toBe(items)
  saveProjectSessionOrder('project', items, ['c', 'a', 'b'])
  expect(
    ids(
      orderProjectSessions(
        [session('b', 20, 100), ...items.filter(item => item.id !== 'b')],
        $projectSessionOrders.get().project
      )
    )
  ).toEqual(['c', 'a', 'b'])
})

it('prepends new creations, appends older pages, and retains deleted/filtered ranks for later reappearance', () => {
  const items = [session('a', 30), session('b', 20), session('c', 10)]
  saveProjectSessionOrder('project', items, ['c', 'a', 'b'])
  const refreshed = [session('old-page', 1, 200), session('new', 40), ...items]
  expect(ids(orderProjectSessions(refreshed, $projectSessionOrders.get().project))).toEqual([
    'new',
    'c',
    'a',
    'b',
    'old-page'
  ])
  saveProjectSessionOrder('project', [items[0], items[1]], ['b', 'a'])
  expect(ids(orderProjectSessions(items, $projectSessionOrders.get().project))).toEqual(['c', 'b', 'a'])
})

it('persists separate scope orders and keeps lineage identity across compression', () => {
  const items = [session('a', 30), session('b', 20)]
  saveProjectSessionOrder('profile/project', items, ['b', 'a'])
  saveProjectSessionOrder('other/project', items, ['a', 'b'])
  const restored = JSON.parse(localStorage.getItem('hermes.desktop.projectSessionOrders.v1')!)
  const compressed = { ...session('b-successor', 50), _lineage_root_id: 'b' }
  expect(ids(orderProjectSessions([items[0], compressed], restored['profile/project']))).toEqual(['b-successor', 'a'])
  expect(ids(orderProjectSessions(items, restored['other/project']))).toEqual(['a', 'b'])
})
