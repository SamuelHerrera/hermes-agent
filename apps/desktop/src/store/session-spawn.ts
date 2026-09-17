import { backgroundGatewayForProfile, primaryGatewayProfile } from '@/store/gateway'
import { notifySessionsChanged } from '@/store/live-sync'
import { $profiles, normalizeProfileKey } from '@/store/profile'
import { refreshProjectTree } from '@/store/projects'
import { openBackgroundSessionTile } from '@/store/session-states'
import type { RpcEvent } from '@/types/hermes'

export interface SessionSpawnRequest {
  project: string
  prompt: string
  title?: string
  idempotency_key?: string | null
  open_tab?: boolean
}

export interface SessionSpawnResult {
  success: boolean
  status: string
  session_id?: string | null
  runtime_session_id?: string | null
  profile?: string
  cwd?: string
  link?: string
  tab_status?: string
  error?: string
  idempotency_key?: string
}

export async function spawnProjectSession(args: SessionSpawnRequest, originProfile: string, callerProfileScope?: string): Promise<SessionSpawnResult> {
  const parts = args.project.split('::')

  if (parts.length > 2 || parts.some(part => !part.trim())) {
    throw new Error('Use project or Hermes-profile::project')
  }

  const scopedCaller = parts.length === 1 && callerProfileScope
  const profile = normalizeProfileKey(parts.length === 2 ? parts[0] : callerProfileScope || originProfile)

  if (!scopedCaller && profile !== normalizeProfileKey(originProfile) && !$profiles.get().some(item => item.name === profile)) {
    throw new Error(`Unknown Hermes profile: ${profile}`)
  }

  // A backend-derived shared scope stays on the socket which emitted it;
  // resolving the same name as a separate local/backend alias can misroute it.
  const { gateway, params } = await backgroundGatewayForProfile(scopedCaller ? originProfile : profile)

  // Deliberate allow-list: no history, model, approvals, caller session identity,
  // cwd or credentials may ride this handoff. The backend resolves the project.
  const result = await gateway.request<SessionSpawnResult>('session.spawn', {
    ...params,
    ...(scopedCaller ? { profile: callerProfileScope } : {}),
    project: parts.at(-1)!.trim(),
    prompt: args.prompt,
    title: args.title ?? '',
    idempotency_key: args.idempotency_key ?? null
  })

  result.profile = profile

  if (result.session_id) {
    result.link = `@session:${profile}/${result.session_id}`

    if (args.open_tab) {
      try {
        result.tab_status = openBackgroundSessionTile(result.session_id, profile, result.cwd)
      } catch {
        result.tab_status = 'failed; use the session link'
      }
    }
  }

  return result
}

export async function handleSessionSpawnRequest(event: RpcEvent): Promise<void> {
  const payload = event.payload as (SessionSpawnRequest & { request_id?: string; caller_profile_scope?: string }) | undefined

  if (!payload?.request_id) {
    return
  }

  // Capture the source, not the currently focused profile (which may change
  // during backend startup). Reply on that same authenticated socket.
  const origin = normalizeProfileKey(event.profile ?? primaryGatewayProfile())
  let result: SessionSpawnResult

  try {
    result = await spawnProjectSession(payload, origin, payload.caller_profile_scope)
  } catch (error) {
    result = { success: false, status: 'unknown', error: String(error) }
  }

  try {
    const { gateway } = await backgroundGatewayForProfile(origin)
    await gateway.request('session.spawn.respond', { request_id: payload.request_id, result: JSON.stringify(result) })
  } catch {
    // A caller disconnect/cancel cannot roll back or interrupt independent work.
    // Its retry uses the backend's durable idempotency reservation.
  }
}

export function handleSpawnChanged(event: RpcEvent): void {
  const payload = event.payload as { spawn?: SessionSpawnResult } | undefined

  if (payload?.spawn?.session_id) {
    notifySessionsChanged()
    void refreshProjectTree()
  }
}
