import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'
import { $workspaceEmptyPlaceholder } from '@/store/session'

import { group, split } from '../model'
import { emptyTabbedScreen } from '../screens'
import { $collapsedTreeSides } from '../store'

import { TreeNode } from './tree-node'
import { rootChildSide } from './track-model'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never
  globalThis.CSS ??= {} as never
  globalThis.CSS.escape ??= (value: string) => value
  HTMLElement.prototype.scrollIntoView ??= () => undefined
})

afterEach(() => {
  cleanup()
  $collapsedTreeSides.set(new Set())
})

it('uses a real pane placement after it occupies the empty center', () => {
  const node = group(['tool'], { emptyWorkspace: true })
  expect(rootChildSide(node, () => ({ id: 'tool', area: 'panes', data: { placement: 'right' } }))).toBe('right')
})

it.each([false, true])(
  'shows a secondary empty desktop independently of the primary placeholder (%s)',
  primaryEmpty => {
    $workspaceEmptyPlaceholder.set(primaryEmpty)
    const dispose = registry.register({
      id: 'sessions',
      area: 'panes',
      title: 'Sessions',
      data: { placement: 'left', width: '280px', maxWidth: '520px' },
      render: () => <div>Sidebar</div>
    })
    const tree = emptyTabbedScreen(split('row', [group(['sessions']), group(['workspace'])]), '2')
    try {
      const { container } = render(<TreeNode node={tree} root rootRow />)
      const message = screen.getByText('No tabs open')
      for (let el: HTMLElement | null = message; el && el !== container; el = el.parentElement) {
        expect(el.style.display).not.toBe('none')
      }
      expect(container.querySelector('[data-tree-tab]')).toBeNull()
    } finally {
      cleanup()
      dispose()
    }
  }
)

it('keeps the empty center visible when the right sidebar is collapsed', () => {
  $collapsedTreeSides.set(new Set(['right']))
  const tree = emptyTabbedScreen(split('row', [group(['sessions']), group(['workspace'])]), '3')
  const { container } = render(<TreeNode node={tree} root rootRow />)
  const message = screen.getByText('No tabs open')
  for (let el: HTMLElement | null = message; el && el !== container; el = el.parentElement) {
    expect(el.style.display).not.toBe('none')
  }
})
