import { useEffect, useRef } from 'react'

import { sessionTitleDiagnostic } from '@/lib/session-title-diagnostics'
import { logUatEvent } from '@/lib/uat-diagnostics'
import type { SessionInfo } from '@/types/hermes'

/** Log committed labels, not every render or streaming token. No text leaves this hook. */
export function useSessionTitleDiagnostics(surface: string, session: SessionInfo | null | undefined, title: string, selected = false) {
  const previous = useRef('')
  const snapshot = JSON.stringify({ ...sessionTitleDiagnostic(session, title), selected })

  // This ref is diagnostic history, not a mirror used by application callbacks.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (snapshot === previous.current) {
      return
    }

    logUatEvent('session-title', 'surface.changed', {
      surface,
      before: previous.current ? JSON.parse(previous.current) : null,
      after: JSON.parse(snapshot)
    })
    previous.current = snapshot
  }, [snapshot, surface])
}
