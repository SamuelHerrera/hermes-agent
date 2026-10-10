import type { Terminal } from '@xterm/xterm'

/** xterm's virtual viewport has no native touch scroll container. */
export function attachTerminalTouchScroll(
  term: Pick<Terminal, 'element' | 'rows' | 'buffer' | 'scrollLines'>
): () => void {
  const element = term.element

  if (!element) {
    return () => {}
  }

  const previous = element.style.touchAction
  element.style.touchAction = 'none'
  let lastY: number | null = null
  let remainder = 0

  const start = (event: TouchEvent) => {
    lastY = event.touches.length === 1 ? event.touches[0].clientY : null
    remainder = 0
  }

  const move = (event: TouchEvent) => {
    if (lastY === null || event.touches.length !== 1) {
      return
    }

    const y = event.touches[0].clientY
    const delta = lastY - y
    lastY = y
    event.preventDefault()
    event.stopImmediatePropagation()

    if (term.buffer.active.type === 'alternate') {
      // Full-screen terminal apps own wheel input rather than scrollback.
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: delta }))

      return
    }

    const screen = element.querySelector('.xterm-screen') ?? element
    const lineHeight = screen.getBoundingClientRect().height / term.rows

    if (lineHeight <= 0) {
      return
    }

    remainder += delta / lineHeight
    const lines = Math.trunc(remainder)

    if (lines) {
      term.scrollLines(lines)
      remainder -= lines
    }
  }

  const end = () => {
    lastY = null
    remainder = 0
  }

  element.addEventListener('touchstart', start, { passive: true })
  element.addEventListener('touchmove', move, { passive: false, capture: true })
  element.addEventListener('touchend', end)
  element.addEventListener('touchcancel', end)

  return () => {
    element.style.touchAction = previous
    element.removeEventListener('touchstart', start)
    element.removeEventListener('touchmove', move, { capture: true })
    element.removeEventListener('touchend', end)
    element.removeEventListener('touchcancel', end)
  }
}
