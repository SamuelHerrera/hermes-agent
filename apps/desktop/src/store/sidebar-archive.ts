import { atom, computed } from 'nanostores'

import { listAllProfileSessions, type SessionInfo } from '@/hermes'

import { $sessions, sessionMatchesStoredId, setSessions } from './session'

// Archived rows are excluded from the sessions query, so the Archived view has
// to fetch its own set. Capped: it's a lookup surface, not a feed.
const ARCHIVED_FETCH_LIMIT = 200

export const $archivedSessions = atom<SessionInfo[]>([])
export const $archivedSessionsLoading = atom(false)

interface RemoteArchiveRequest {
  nonce: number
  profile?: string | null
  sessionIds: string[]
}

export const $remoteArchiveRequest = atom<RemoteArchiveRequest>({ nonce: 0, sessionIds: [] })

export function requestRemoteArchiveCleanup(sessionIds: readonly string[], profile?: string | null): void {
  $remoteArchiveRequest.set({
    nonce: $remoteArchiveRequest.get().nonce + 1,
    profile,
    sessionIds: [...sessionIds]
  })
}

interface ArchivedSessionMatch {
  ids: readonly string[]
  profile?: string | null
}

function removeMatchingArchivedRows(matches: readonly ArchivedSessionMatch[]): void {
  const normalized = matches
    .map(match => ({ ...match, ids: match.ids.map(id => id.trim()).filter(Boolean) }))
    .filter(match => match.ids.length)

  if (!normalized.length) {
    return
  }

  setSessions(previous =>
    previous.filter(
      session =>
        !normalized.some(
          match =>
            (!match.profile || !session.profile || session.profile === match.profile) &&
            match.ids.some(id => sessionMatchesStoredId(session, id))
        )
    )
  )
}

/** Remove backend-confirmed archived conversations from the live recents cache.
 * This is also used by cross-client archive broadcasts: an open/pinned row is
 * normally preserved when a recents page omits it, so absence alone is not
 * enough to evict it. */
export function removeArchivedSessionRows(sessionIds: readonly string[], profile?: string | null): void {
  removeMatchingArchivedRows([{ ids: sessionIds, profile }])
}

export async function loadArchivedSessions(): Promise<void> {
  if ($archivedSessionsLoading.get()) {
    return
  }

  $archivedSessionsLoading.set(true)

  try {
    const result = await listAllProfileSessions(ARCHIVED_FETCH_LIMIT, 0, 'only')

    $archivedSessions.set(result.sessions)
    removeMatchingArchivedRows(
      result.sessions.map(session => ({
        ids: [session.id, session._lineage_root_id ?? ''],
        profile: session.profile
      }))
    )
  } catch {
    $archivedSessions.set([])
  } finally {
    $archivedSessionsLoading.set(false)
  }
}

/** Spend on a session — provider-reported price when we have one, our own
 *  estimate otherwise. */
export const sessionCostUsd = (session: SessionInfo): number =>
  session.actual_cost_usd || session.estimated_cost_usd || 0

/** Whether ANY loaded session reports spend. Subscription auth never quotes a
 *  price, so for those users a cost sort would rank a list of zeroes — the
 *  menu hides the option instead of offering a dead one. */
export const $sessionsHaveCost = computed($sessions, sessions => sessions.some(session => sessionCostUsd(session) > 0))
