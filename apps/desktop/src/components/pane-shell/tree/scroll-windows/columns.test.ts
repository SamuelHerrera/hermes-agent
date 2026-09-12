import { describe, expect, it } from 'vitest'

import { legacyColumns, moveColumnWindow, reconcileColumns } from './columns'
import { generateScrollGrid, scrollGridWindowRect } from './grid'

const base = {
  gap: 12,
  minWindowHeight: 280,
  minWindowWidth: 360,
  maxWindowWidth: 814,
  viewportWidth: 2000,
  viewportHeight: 1000,
  windowCount: 4
}

describe('independent scroll columns', () => {
  it('splits only the target column, keeps neighbors full height, and reverses to single columns', () => {
    const original = [['a'], ['b'], ['c'], ['d']]
    const split = moveColumnWindow(original, 'c', 'a', 'bottom')
    expect(split).toEqual([['a', 'c'], ['b'], ['d']])
    expect(original).toEqual([['a'], ['b'], ['c'], ['d']])
    const layout = generateScrollGrid({ ...base, columnSizes: split.map(column => column.length) })
    const a = scrollGridWindowRect(layout, 0, base.gap)
    const c = scrollGridWindowRect(layout, 1, base.gap)
    const b = scrollGridWindowRect(layout, 2, base.gap)
    expect(c.left).toBe(a.left)
    expect(c.top).toBe(a.height + base.gap)
    expect(b.height).toBe(base.viewportHeight)
    expect(c.top + c.height).toBe(b.height)
    expect(moveColumnWindow(split, 'c', 'b', 'right')).toEqual(original)
  })
  it('supports top, left and within-stack moves without touching other columns', () => {
    const columns = [['a', 'b'], ['c'], ['d']]
    expect(moveColumnWindow(columns, 'b', 'a', 'top')).toEqual([['b', 'a'], ['c'], ['d']])
    expect(moveColumnWindow(columns, 'b', 'c', 'left')).toEqual([['a'], ['b'], ['c'], ['d']])
    expect(moveColumnWindow(columns, 'missing', 'a', 'bottom')).toEqual(columns)
    expect(moveColumnWindow(columns, 'a', 'a', 'bottom')).toEqual(columns)
  })
  it('closing compacts just the emptied stack and adding opens an independent rightmost column', () => {
    expect(reconcileColumns([['a', 'b'], ['c'], ['d']], ['a', 'c', 'new'])).toEqual([['a'], ['c'], ['new']])
    expect(
      reconcileColumns(
        [
          ['a', 'a'],
          ['a', 'b']
        ],
        ['a', 'b']
      )
    ).toEqual([['a'], ['b']])
  })
  it('migrates old row-major layouts without losing window positions', () => {
    expect(legacyColumns(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'd'], ['b', 'e'], ['c']])
    expect(legacyColumns([], 1)).toEqual([])
  })
  it('keeps oversized stacks scrollable without stretching neighboring columns', () => {
    const layout = generateScrollGrid({ ...base, viewportHeight: 500, columnSizes: [3, 1] })
    const third = scrollGridWindowRect(layout, 2, base.gap)
    expect(third.height).toBe(base.minWindowHeight)
    expect(layout.canvasHeight).toBe(third.top + third.height)
    expect(scrollGridWindowRect(layout, 3, base.gap).height).toBe(500)
  })
})
