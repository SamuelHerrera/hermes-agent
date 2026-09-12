import { describe, expect, it, vi } from 'vitest'

import { consumeScrollWindowWheel, createScrollWheelAxisState, scrollWindowHorizontalDelta } from './wheel'

function wheel(init: Partial<WheelEvent> & { deltaX: number; deltaY: number; timeStamp?: number }): WheelEvent {
  return {
    deltaX: init.deltaX,
    deltaY: init.deltaY,
    preventDefault: vi.fn(),
    shiftKey: init.shiftKey ?? false,
    stopPropagation: vi.fn(),
    timeStamp: init.timeStamp ?? 1
  } as unknown as WheelEvent
}

function viewport(scrollLeft = 0) {
  const element = document.createElement('div')

  Object.defineProperty(element, 'clientWidth', { configurable: true, value: 100 })
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: 300 })
  element.scrollLeft = scrollLeft

  return element
}

describe('scroll-window wheel axis locking', () => {
  it('locks a diagonal trackpad gesture as vertical instead of leaking horizontal scroll', () => {
    const state = createScrollWheelAxisState()

    expect(scrollWindowHorizontalDelta(wheel({ deltaX: 6, deltaY: 24, timeStamp: 10 }), state)).toBe(0)
    expect(scrollWindowHorizontalDelta(wheel({ deltaX: 18, deltaY: 38, timeStamp: 24 }), state)).toBe(0)
  })

  it('allows gestures that start with clear horizontal intent', () => {
    const state = createScrollWheelAxisState()

    expect(scrollWindowHorizontalDelta(wheel({ deltaX: 24, deltaY: 3, timeStamp: 10 }), state)).toBe(24)
    expect(scrollWindowHorizontalDelta(wheel({ deltaX: 12, deltaY: 18, timeStamp: 24 }), state)).toBe(12)
  })

  it('starts a new gesture after the wheel stream goes idle', () => {
    const state = createScrollWheelAxisState()

    expect(scrollWindowHorizontalDelta(wheel({ deltaX: 3, deltaY: 18, timeStamp: 10 }), state)).toBe(0)
    expect(scrollWindowHorizontalDelta(wheel({ deltaX: 20, deltaY: 2, timeStamp: 220 }), state)).toBe(20)
  })

  it('maps shift vertical wheel to horizontal scroll', () => {
    const state = createScrollWheelAxisState()

    expect(scrollWindowHorizontalDelta(wheel({ deltaX: 0, deltaY: 42, shiftKey: true, timeStamp: 10 }), state)).toBe(42)
  })

  it('only prevents the native event when the viewport consumes horizontal movement', () => {
    const state = createScrollWheelAxisState()
    const event = wheel({ deltaX: 30, deltaY: 0, timeStamp: 10 })
    const element = viewport()

    expect(consumeScrollWindowWheel(event, element, state)).toBe(true)
    expect(element.scrollLeft).toBe(30)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('does not prevent vertical terminal/body wheel events', () => {
    const state = createScrollWheelAxisState()
    const event = wheel({ deltaX: 5, deltaY: 30, timeStamp: 10 })

    expect(consumeScrollWindowWheel(event, viewport(), state)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })
})
