import { describe, expect, it } from 'vitest'

import { generateScrollGrid } from './grid'

const base = {
  gap: 12,
  minWindowHeight: 280,
  minWindowWidth: 360
}

describe('generateScrollGrid', () => {
  it('keeps a single chat as one full window', () => {
    expect(generateScrollGrid({ ...base, viewportHeight: 720, viewportWidth: 1280, windowCount: 1 })).toMatchObject({
      columns: 1,
      rows: 1,
      windowHeight: 720,
      windowWidth: 1280
    })
  })

  it('opens additional windows to the right by default', () => {
    expect(generateScrollGrid({ ...base, viewportHeight: 720, viewportWidth: 1280, windowCount: 4 })).toMatchObject({
      columns: 4,
      rows: 1
    })

    expect(generateScrollGrid({ ...base, viewportHeight: 900, viewportWidth: 1600, windowCount: 6 })).toMatchObject({
      columns: 6,
      rows: 1
    })
  })

  it('extends horizontally instead of creating automatic rows', () => {
    const layout = generateScrollGrid({ ...base, viewportHeight: 620, viewportWidth: 820, windowCount: 6 })

    expect(layout.rows).toBe(1)
    expect(layout.columns).toBe(6)
    expect(layout.windowWidth).toBeGreaterThanOrEqual(base.minWindowWidth)
    expect(layout.windowHeight).toBeGreaterThanOrEqual(base.minWindowHeight)
    expect(layout.canvasWidth).toBeGreaterThan(820)
    expect(layout.canvasHeight).toBeLessThanOrEqual(620)
  })

  it('only creates rows when explicit row state asks for them', () => {
    const layout = generateScrollGrid({ ...base, rows: 2, viewportHeight: 620, viewportWidth: 820, windowCount: 6 })

    expect(layout.rows).toBe(2)
    expect(layout.columns).toBe(3)
    expect(layout.canvasHeight).toBeLessThanOrEqual(620)
  })
})
