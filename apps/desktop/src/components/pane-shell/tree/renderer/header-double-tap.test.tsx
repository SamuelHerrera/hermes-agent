import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

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
})
