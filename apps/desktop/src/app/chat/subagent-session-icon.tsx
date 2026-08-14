import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { isSubagentSession } from '@/lib/chat-runtime'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $sessionDotStateById, showsRunningArc } from '@/store/session-dot-state'
import type { SessionInfo } from '@/types/hermes'

import { SessionStatusDot } from './session-status-dot'

export interface SubagentSessionIconProps {
  className?: string
  session: null | Pick<SessionInfo, 'delegate_parent_session_id' | 'source'> | undefined
  size?: number | string
  storedSessionId: null | string
  tooltip?: boolean
}

export interface SessionTabLeadProps {
  session: null | SessionInfo | undefined
  storedSessionId: null | string
}

/** A tab has one leading glyph: subagent identity owns the slot when present;
 * every other session uses the normal state/project-color treatment. */
export function SessionTabLead({ session, storedSessionId }: SessionTabLeadProps) {
  return isSubagentSession(session) ? (
    <SubagentSessionIcon session={session} storedSessionId={storedSessionId} />
  ) : (
    <SessionStatusDot session={session} storedSessionId={storedSessionId} />
  )
}

/** Secondary subagent identity glyph. While the subagent's own turn is running,
 *  it yields to the same loading treatment the status dot uses so the row/tab
 *  doesn't say both "robot" and "running" at once. */
export function SubagentSessionIcon({
  className,
  session,
  size = '0.75rem',
  storedSessionId,
  tooltip = false
}: SubagentSessionIconProps) {
  const dotState = useStoreSelector($sessionDotStateById, states => (storedSessionId ? (states[storedSessionId] ?? 'idle') : 'idle'))

  if (!isSubagentSession(session)) {
    return null
  }

  const running = showsRunningArc(dotState)

  const icon = (
    <Codicon
      className={cn('shrink-0 text-(--ui-text-tertiary)', running && 'text-(--ui-accent)', className)}
      name={running ? 'loading' : 'robot'}
      size={size}
      spinning={running}
    />
  )

  return tooltip ? <Tip label={running ? 'Subagent running' : 'Subagent'}>{icon}</Tip> : icon
}
