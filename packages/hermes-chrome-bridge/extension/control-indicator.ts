interface IndicatorTimer {
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
}

interface IndicatorOptions {
  idleMs?: number
  timer?: IndicatorTimer
}

export interface ControlIndicator {
  activity(target?: Element): void
  destroy(): void
  hide(): void
  refresh(): void
}

const INDICATOR_ID = '__hermes_chrome_control_indicator'

export function createControlIndicator(
  document: Document,
  options: IndicatorOptions = {}
): ControlIndicator {
  const timer = options.timer ?? {
    clearTimeout: handle => clearTimeout(handle),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs)
  }

  const idleMs = Math.max(250, Math.min(10_000, options.idleMs ?? 1_500))
  let idleHandle: ReturnType<typeof setTimeout> | undefined
  let host: HTMLElement | undefined
  let root: HTMLElement | undefined
  let cursor: HTMLElement | undefined
  let lastTarget: Element | undefined

  function mount(): void {
    if (host !== undefined) { return }

    host = document.createElement('div')
    host.id = INDICATOR_ID
    host.hidden = true
    host.setAttribute('aria-hidden', 'true')
    host.setAttribute('data-hermes-chrome-control', 'true')
    Object.assign(host.style, {
      all: 'initial',
      inset: '0',
      pointerEvents: 'none',
      position: 'fixed',
      zIndex: '2147483647'
    })

    const shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = `
      :host { all: initial; }
      .root { inset: 0; opacity: 0.35; pointer-events: none; position: fixed; transition: opacity 180ms ease; }
      .pill { align-items: center; background: rgba(20, 18, 14, 0.92); border: 1px solid rgba(245, 190, 73, 0.72); border-radius: 999px; box-shadow: 0 5px 18px rgba(0, 0, 0, 0.3); color: #fff7df; display: flex; font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; gap: 7px; padding: 7px 10px; position: fixed; right: 12px; top: 12px; }
      .dot { background: #f5be49; border-radius: 50%; box-shadow: 0 0 0 3px rgba(245, 190, 73, 0.2); height: 7px; width: 7px; }
      .cursor { align-items: center; background: #f5be49; border: 2px solid #fff7df; border-radius: 50%; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); color: #211806; display: flex; font: 800 9px/1 sans-serif; height: 18px; justify-content: center; left: -11px; opacity: 0; position: fixed; top: -11px; transition: opacity 120ms ease, transform 180ms ease; width: 18px; }
    `

    root = document.createElement('div')
    root.className = 'root'
    root.style.opacity = '0.35'

    const pill = document.createElement('div')
    pill.className = 'pill'
    const dot = document.createElement('span')
    dot.className = 'dot'
    const label = document.createElement('span')
    label.textContent = 'Hermes is controlling Chrome'
    pill.append(dot, label)

    cursor = document.createElement('div')
    cursor.className = 'cursor'
    cursor.textContent = 'H'
    root.append(pill, cursor)
    shadow.append(style, root)
    document.documentElement.append(host)
  }

  function clearIdle(): void {
    if (idleHandle !== undefined) {
      timer.clearTimeout(idleHandle)
      idleHandle = undefined
    }
  }

  function refresh(): void {
    mount()
    clearIdle()

    if (host === undefined || root === undefined || cursor === undefined) { return }

    host.hidden = false
    root.style.opacity = '1'

    const width = document.defaultView?.innerWidth ?? Number.POSITIVE_INFINITY
    const height = document.defaultView?.innerHeight ?? Number.POSITIVE_INFINITY
    const bounds = lastTarget?.getBoundingClientRect()

    const position = {
      x: bounds === undefined
        ? 24
        : Math.max(12, Math.min(Math.round(bounds.x + bounds.width / 2), width - 12)),
      y: bounds === undefined
        ? 24
        : Math.max(12, Math.min(Math.round(bounds.y + bounds.height / 2), height - 12))
    }

    cursor.style.opacity = '1'
    cursor.style.transform = `translate(${position.x}px, ${position.y}px)`
  }

  return {
    activity(target) {
      mount()
      clearIdle()

      if (host === undefined || root === undefined || cursor === undefined) { return }

      host.hidden = false
      root.style.opacity = '1'

      if (target === undefined) {
        lastTarget = undefined
        cursor.style.opacity = '0'
      } else {
        lastTarget = target
        refresh()
      }

      idleHandle = timer.setTimeout(() => {
        if (root !== undefined) { root.style.opacity = '0.35' }

        if (cursor !== undefined) { cursor.style.opacity = '0' }
        idleHandle = undefined
      }, idleMs)
    },

    destroy() {
      clearIdle()
      host?.remove()
      host = undefined
      root = undefined
      cursor = undefined
      lastTarget = undefined
    },

    hide() {
      clearIdle()
      lastTarget = undefined

      if (host !== undefined) { host.hidden = true }
    },

    refresh
  }
}
