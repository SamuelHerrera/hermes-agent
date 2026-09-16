import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'
import { EmptyWorkspace } from '@/components/pane-shell/empty-workspace'
import { $workspaceEmptyPlaceholder } from '@/store/session'

import { group, split } from '../model'
import { emptyTabbedScreen } from '../screens'
import { $collapsedTreeSides } from '../store'

import { rootChildSide } from './track-model'
import { TreeNode } from './tree-node'

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

it('does not reserve a header strip for a workspace-only empty placeholder', () => {
  $workspaceEmptyPlaceholder.set(true)
  const disposes = [
    registry.register({
      id: 'sessions',
      area: 'panes',
      title: 'Sessions',
      data: { placement: 'left' },
      render: () => <div>Sidebar</div>
    }),
    registry.register({
      id: 'workspace',
      area: 'panes',
      title: 'Workspace',
      data: { placement: 'main' },
      render: () => <EmptyWorkspace />
    }),
    registry.register({
      id: 'files',
      area: 'panes',
      title: 'Files',
      data: { placement: 'right' },
      render: () => <div>Files</div>
    })
  ]
  const tree = split('row', [group(['sessions']), group(['workspace']), group(['files'])])

  try {
    const { container } = render(<TreeNode node={tree} root rootRow />)

    expect(screen.getByText('No tabs open')).toBeTruthy()
    expect(container.querySelector('[data-zone-header]')).toBeNull()
    expect(container.querySelector('[data-tree-tab]')).toBeNull()
  } finally {
    for (const dispose of disposes) {
      dispose()
    }
    $workspaceEmptyPlaceholder.set(false)
  }
})
