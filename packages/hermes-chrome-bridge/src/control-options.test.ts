import { describe, expect, it } from 'vitest'

import { validControlArguments, validInspectionOptions } from './control-options.js'

describe('control boundary', () => {
  it('accepts bounded coordinate gestures without ambiguous or incomplete targets', () => {
    expect(validControlArguments('click', { tabId: 1, x: 50, y: 80 })).toBe(true)
    expect(validControlArguments('control', { tabId: 1, action: 'drag', x: 50, y: 80, destinationX: 150, destinationY: 180 })).toBe(true)

    for (const point of [{ x: 1 }, { x: NaN, y: 2 }, { x: -1, y: 2 }, { x: 1, y: 2, target: '#a' }]) {
      expect(validControlArguments('click', { tabId: 1, ...point })).toBe(false)
    }

    expect(validControlArguments('click', { tabId: 1, x: 1, y: 2, inputRoute: 'dom_event' })).toBe(false)
  })
  it('validates trusted input and explicit downgrade with frame selection', () => {
    expect(validControlArguments('click', { tabId: 1, target: '#a', frameId: 2 })).toBe(true)
    expect(validControlArguments('click', { tabId: 1, target: '#a', inputRoute: 'dom_event' })).toBe(true)
    expect(validControlArguments('click', { tabId: 1, target: '#a', inputRoute: 'guess' })).toBe(false)
    expect(validControlArguments('control', { tabId: 1, action: 'drag', target: '#a', destination: '#b' })).toBe(true)
    expect(validControlArguments('control', { tabId: 1, action: 'upload', target: '#file', files: ['/tmp/a'], approvalIntent: 'explicit-user-approved-files' })).toBe(true)
    expect(validControlArguments('control', { tabId: 1, action: 'upload', target: '#file', files: ['/tmp/a'] })).toBe(false)
  })
  it('bounds projection and pagination consistently', () => {
    expect(validInspectionOptions({ limit: 500, maxChars: 240, fields: ['ref', 'box'], cursor: 'opaque', visibleOnly: true })).toBe(true)
    expect(validInspectionOptions({ limit: 501 })).toBe(false)
    expect(validInspectionOptions({ maxChars: 241 })).toBe(false)
    expect(validInspectionOptions({ fields: ['html'] })).toBe(false)
  })
})
