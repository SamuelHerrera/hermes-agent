import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'
import { $workspaceEmptyPlaceholder } from '@/store/session'

import { findGroup, group } from '../model'
import { $layoutTree, declareDefaultTree } from '../store'

import { TreeGroup } from './tree-group'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver ??= TestResizeObserver as never
  globalThis.CSS ??= {} as never
  globalThis.CSS.escape ??= (value: string) => value
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  HTMLElement.prototype.scrollIntoView ??= () => undefined
})

const disposers: (() => void)[] = []

beforeEach(() => {
  window.localStorage.clear()
  $workspaceEmptyPlaceholder.set(false)
  disposers.push(
    registry.register({
      area: 'panes',
      data: { placement: 'main', uncloseable: true },
      id: 'workspace',
      render: () => null,
      title: 'workspace'
    }),
    registry.register({
      area: 'panes',
      data: { placement: 'main' },
      id: 'session-tile:one',
      render: () => null,
      title: 'one'
    }),
    registry.register({
      area: 'panes',
      data: { placement: 'left', collapsible: true },
      id: 'sessions',
      render: () => <div>Sessions body</div>,
      title: 'sessions'
    })
  )
})

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
})

function tap(target: HTMLElement, pointerId: number) {
  fireEvent.pointerDown(target, { button: 0, clientX: 10, clientY: 10, pointerId })
  fireEvent.pointerUp(window, { button: 0, clientX: 10, clientY: 10, pointerId })
}

describe('pane tab/header double tap', () => {
  it('renders the tab strip for a lone workspace, even with stale hidden state', () => {
    const node = group(['workspace'], { active: 'workspace', headerHidden: true, id: 'grp-main' })
    declareDefaultTree(node)
    const { container } = render(<TreeGroup node={node} />)

    expect(container.querySelector('[data-zone-tabstrip="grp-main"]')).toBeTruthy()
  })

  it('renders the tab strip for a full-page workspace route', () => {
    disposers.push(
      registry.register({
        area: 'panes',
        data: { headerVeto: true, placement: 'main', uncloseable: true },
        id: 'page-workspace',
        render: () => null,
        title: 'page'
      })
    )
    const node = group(['page-workspace'], { active: 'page-workspace', id: 'grp-page' })
    declareDefaultTree(node)
    const { container } = render(<TreeGroup node={node} />)

    expect(container.querySelector('[data-zone-tabstrip="grp-page"]')).toBeTruthy()
  })

  it('keeps the strip but hides the workspace chip for the close-all placeholder', () => {
    $workspaceEmptyPlaceholder.set(true)
    const node = group(['workspace'], { active: 'workspace', id: 'grp-empty' })
    declareDefaultTree(node)
    const { container } = render(<TreeGroup node={node} />)

    expect(container.querySelector('[data-zone-tabstrip="grp-empty"]')).toBeTruthy()
    expect(container.querySelector('[data-tree-tab="workspace"]')).toBeNull()
  })

  it('fronts sibling editor tabs instead of showing an empty workspace tab beside them', () => {
    $workspaceEmptyPlaceholder.set(true)
    disposers.push(
      registry.register({
        area: 'panes',
        data: { placement: 'main' },
        id: 'route-tile:/kanban',
        render: () => <div>Kanban body</div>,
        title: 'Kanban'
      })
    )

    const node = group(['workspace', 'route-tile:/kanban', 'session-tile:one'], {
      active: 'workspace',
      id: 'grp-main'
    })

    declareDefaultTree(node)
    const { container } = render(<TreeGroup node={node} />)

    expect(container.querySelector('[data-zone-tabstrip="grp-main"]')).toBeTruthy()
    expect(container.querySelector('[data-tree-tab="workspace"]')).toBeNull()
    expect(container.querySelector('[data-tree-tab="route-tile:/kanban"]')).toBeTruthy()
    expect(container.querySelector('[data-tree-tab="session-tile:one"]')).toBeTruthy()
    expect(screen.getByText('Kanban body')).toBeTruthy()
  })

  it('does not hide the tab strip on double click', () => {
    const node = group(['workspace', 'session-tile:one'], { active: 'workspace', headerHidden: false, id: 'grp-main' })
    declareDefaultTree(node)
    const { container } = render(<TreeGroup node={node} />)

    const strip = container.querySelector<HTMLElement>('[data-zone-tabstrip="grp-main"]')
    expect(strip).toBeTruthy()

    tap(strip!, 1)
    tap(strip!, 2)

    expect(findGroup($layoutTree.get()!, 'grp-main')?.headerHidden).not.toBe(true)
  })

  it('does not minimize a split pane from empty tab-strip taps', () => {
    const node = group(['session-tile:one'], { active: 'session-tile:one', id: 'grp-secondary' })
    declareDefaultTree(node)
    const { container } = render(<TreeGroup node={node} parentAxis="row" />)

    const strip = container.querySelector<HTMLElement>('[data-zone-tabstrip="grp-secondary"]')
    expect(strip).toBeTruthy()
    expect(screen.queryByRole('button', { name: /minimize/i })).toBeNull()

    tap(strip!, 3)

    expect(findGroup($layoutTree.get()!, 'grp-secondary')?.minimized).not.toBe(true)
  })

  it('ignores stale minimized state for ordinary split panes', () => {
    const node = group(['session-tile:one'], {
      active: 'session-tile:one',
      id: 'grp-secondary',
      minimized: true
    })

    declareDefaultTree(node)
    const { container } = render(<TreeGroup node={node} parentAxis="row" />)

    expect(container.querySelector('[data-zone-tabstrip="grp-secondary"]')).toBeTruthy()
    expect(container.querySelector('[data-tree-tab="session-tile:one"]')).toBeTruthy()
  })

  it('hides the tab strip for the fixed sessions-only left panel', () => {
    const node = group(['sessions'], { active: 'sessions', id: 'grp-sessions' })
    declareDefaultTree(node)
    const { container } = render(<TreeGroup node={node} parentAxis="row" railSide="left" />)

    expect(container.querySelector('[data-zone-tabstrip="grp-sessions"]')).toBeNull()
    expect(screen.getByText('Sessions body')).toBeTruthy()
  })
})
