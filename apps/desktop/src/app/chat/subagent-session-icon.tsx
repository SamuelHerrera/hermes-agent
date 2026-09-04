import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { isSubagentSession } from '@/lib/chat-runtime'
import { cn } from '@/lib/utils'
import type { SessionInfo } from '@/types/hermes'

import { SessionAttentionDot, SessionProjectDot } from './session-status-dot'

export interface SubagentSessionIconProps {
  className?: string
  session: null | Pick<SessionInfo, 'delegate_parent_session_id' | 'source'> | undefined
  size?: number | string
  storedSessionId: null | string
  tooltip?: boolean
}

export interface SessionTabLeadProps {
  fallbackColor?: null | string
  session: null | SessionInfo | undefined
  storedSessionId: null | string
}

/** A tab has a stable leading identity glyph: subagents keep the robot, every
 * other session keeps the project/session color dot. Live loading wraps that
 * dot; settled attention stays on the tab's trailing edge. */
export function SessionTabLead({ fallbackColor, session, storedSessionId }: SessionTabLeadProps) {
  return isSubagentSession(session) ? (
    <SubagentSessionIcon session={session} storedSessionId={storedSessionId} />
  ) : (
    <SessionProjectDot fallbackColor={fallbackColor} session={session} storedSessionId={storedSessionId} />
  )
}

export function SessionTabAttentionDot({ storedSessionId }: Pick<SessionTabLeadProps, 'storedSessionId'>) {
  return <SessionAttentionDot storedSessionId={storedSessionId} />
}

/** Secondary subagent identity glyph. This is stable identity, not transient
 *  turn status: keep the robot in the leading slot even while the child runs so
 *  active child rows do not look like top-level loading sessions. */
export function SubagentSessionIcon({
  className,
  session,
  size = '0.75rem',
  tooltip = false
}: SubagentSessionIconProps) {
  if (!isSubagentSession(session)) {
    return null
  }

  const icon = <Codicon className={cn('shrink-0 text-(--ui-text-tertiary)', className)} name="robot" size={size} />

  return tooltip ? <Tip label="Subagent">{icon}</Tip> : icon
}
