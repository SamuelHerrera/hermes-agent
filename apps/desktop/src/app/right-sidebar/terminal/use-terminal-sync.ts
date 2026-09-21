import { useEffect } from 'react'

import { syncSharedTerminals } from './terminals'

const TERMINAL_SYNC_INTERVAL_MS = 1_000

/** Reconcile backend-owned terminal tabs while this renderer is visible. */
export function useTerminalSync(profile: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return
    }

    let disposed = false
    let running = false

    const sync = async () => {
      if (disposed || running || document.visibilityState !== 'visible') {
        return
      }

      running = true

      try {
        await syncSharedTerminals(profile)
      } catch {
        // Older hosts and transient reconnects retain the renderer cache. The
        // next visibility/interval tick retries without deleting local tabs.
      } finally {
        running = false
      }
    }

    const onVisibility = () => void sync()
    const timer = window.setInterval(() => void sync(), TERMINAL_SYNC_INTERVAL_MS)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    void sync()

    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [enabled, profile])
}
