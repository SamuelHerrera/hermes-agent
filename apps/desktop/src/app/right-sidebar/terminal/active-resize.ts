interface ActiveTerminalResizeOptions {
  fitOnActivate?: boolean
  onActivate: () => void
  onFit: () => void
}

/**
 * Observe one visible xterm host.
 *
 * Inactive terminals never call this helper, so their preserved DOM/PTY stays
 * mounted without paying for ResizeObserver delivery or FitAddon work. The
 * first frame owns activation and ignores the observer's initial delivery;
 * later resize bursts are coalesced to one fit per animation frame.
 */
export function observeActiveTerminalResize(
  host: HTMLElement,
  { fitOnActivate = true, onActivate, onFit }: ActiveTerminalResizeOptions
): () => void {
  let activated = false
  let frame = 0
  let initialResizeDelivered = false
  let stopped = false

  const scheduleFrame = (run: () => void) => {
    if (stopped || frame !== 0) {
      return
    }

    frame = window.requestAnimationFrame(() => {
      frame = 0

      if (!stopped) {
        run()
      }
    })
  }

  const runWake = (fit: boolean) => {
    if (fit) {
      onFit()
    }

    onActivate()
  }

  const scheduleFit = () => {
    if (!activated) {
      return
    }

    scheduleFrame(onFit)
  }

  const scheduleWake = () => {
    if (!activated || document.visibilityState === 'hidden') {
      return
    }

    scheduleFrame(() => runWake(true))
  }

  const observer = new ResizeObserver(() => {
    // ResizeObserver's initial delivery is asynchronous in browsers and may
    // arrive before OR after the activation rAF. Activation already fits the
    // current box, so absorb that first delivery in either ordering.
    if (!initialResizeDelivered) {
      initialResizeDelivered = true

      return
    }

    scheduleFit()
  })

  observer.observe(host)

  scheduleFrame(() => {
    activated = true
    runWake(fitOnActivate)
  })

  const handleVisibility = () => {
    scheduleWake()
  }

  const handleWindowState = (payload: { isMinimized?: boolean; isVisible?: boolean }) => {
    if (payload?.isMinimized === false && payload?.isVisible !== false) {
      scheduleWake()
    }
  }

  window.addEventListener('focus', scheduleWake)
  document.addEventListener('visibilitychange', handleVisibility)

  const desktop = (
    window as Window & {
      hermesDesktop?: { onWindowStateChanged?: (callback: typeof handleWindowState) => () => void }
    }
  ).hermesDesktop

  const offWindowState = desktop?.onWindowStateChanged?.(handleWindowState)

  return () => {
    stopped = true
    observer.disconnect()
    window.removeEventListener('focus', scheduleWake)
    document.removeEventListener('visibilitychange', handleVisibility)
    offWindowState?.()


    if (frame !== 0) {
      window.cancelAnimationFrame(frame)
      frame = 0
    }
  }
}
