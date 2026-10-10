import { describe, expect, it, vi } from 'vitest'

import { attachTerminalTouchScroll } from './touch-scroll'

function gesture(element: HTMLElement, type: string, y: number, count = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: Array.from({ length: count }, () => ({ clientY: y })) })
  element.dispatchEvent(event)
  return event
}

describe('terminal touch scrolling', () => {
  it('accumulates partial lines and removes its input ownership on disposal', () => {
    const element = document.createElement('div')
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    element.append(screen)
    vi.spyOn(screen, 'getBoundingClientRect').mockReturnValue({ height: 200 } as DOMRect)
    const scrollLines = vi.fn()
    const dispose = attachTerminalTouchScroll({
      element,
      rows: 20,
      buffer: { active: { type: 'normal' } } as never,
      scrollLines
    })
    gesture(element, 'touchstart', 100)
    gesture(element, 'touchmove', 106)
    expect(scrollLines).not.toHaveBeenCalled()
    expect(gesture(element, 'touchmove', 112).defaultPrevented).toBe(true)
    expect(scrollLines).toHaveBeenCalledWith(-1)
    gesture(element, 'touchcancel', 112, 0)
    gesture(element, 'touchmove', 150)
    expect(scrollLines).toHaveBeenCalledTimes(1)
    dispose()
    gesture(element, 'touchstart', 100)
    expect(gesture(element, 'touchmove', 150).defaultPrevented).toBe(false)
  })

  it('forwards full-screen app gestures to wheel handling, not scrollback', () => {
    const element = document.createElement('div')
    const scrollLines = vi.fn()
    const wheel = vi.fn()
    element.addEventListener('wheel', wheel)
    const dispose = attachTerminalTouchScroll({
      element,
      rows: 20,
      buffer: { active: { type: 'alternate' } } as never,
      scrollLines
    })
    gesture(element, 'touchstart', 100)
    gesture(element, 'touchmove', 120)
    expect(wheel).toHaveBeenCalledOnce()
    expect((wheel.mock.calls[0][0] as WheelEvent).deltaY).toBe(-20)
    expect(scrollLines).not.toHaveBeenCalled()
    dispose()
  })
})
