import type { Terminal } from '@xterm/xterm'

/** ResizeObserver can report CSS-sized device-pixel boxes on mobile Chromium.
 * xterm's WebGL addon then shrinks the canvas without updating its viewport or
 * shader resolution, clipping every glyph. Fall back to DOM, not a new PTY.
 */
export function watchTerminalWebglSizing(term: Pick<Terminal, 'element'>, fallback: () => void): { dispose(): void } {
  const screen = term.element?.querySelector('.xterm-screen')
  const view = screen?.ownerDocument.defaultView
  if (!screen || !view) { return { dispose() {} } }

  let frame = 0
  let disposed = false
  const dispose = () => {
    disposed = true
    observer.disconnect()
    if (frame) { view.cancelAnimationFrame(frame) }
  }
  const check = () => {
    frame = 0
    if (disposed) { return }
    const canvas = screen.querySelector<HTMLCanvasElement>('canvas:not(.xterm-link-layer)')
    if (!canvas) { return }
    const width = Number.parseFloat(canvas.style.width)
    const height = Number.parseFloat(canvas.style.height)
    if (!(width > 0 && height > 0)) { return }
    // Allow rounding at fractional DPR, but not a CSS-pixel backing buffer.
    if (Math.abs(canvas.width - width * view.devicePixelRatio) > 2 || Math.abs(canvas.height - height * view.devicePixelRatio) > 2) {
      dispose()
      fallback()
    }
  }
  const observer = new MutationObserver(() => {
    if (!frame && !disposed) { frame = view.requestAnimationFrame(check) }
  })
  observer.observe(screen, { attributes: true, attributeFilter: ['width', 'height'], childList: true, subtree: true })
  frame = view.requestAnimationFrame(check)
  return { dispose }
}
