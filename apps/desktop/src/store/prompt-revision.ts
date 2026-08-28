const MAX_TRACKED_SESSIONS = 512
const revisions = new Map<string, number>()
let checkpoint = 0

const keyFor = (sessionId: string | null | undefined): string => sessionId ?? ''

/** Monotonic per-session revision for blocking prompt state. */
export function pendingPromptRevision(sessionId: string | null | undefined): number {
  return revisions.get(keyFor(sessionId)) ?? 0
}

export function pendingPromptCheckpoint(): number {
  return checkpoint
}

export function pendingPromptChangedSince(sessionId: string | null | undefined, since: number): boolean {
  return pendingPromptRevision(sessionId) > since
}

/** Record a live prompt set/clear so stale resume snapshots cannot replay it. */
export function markPendingPromptChanged(sessionId: string | null | undefined): void {
  const key = keyFor(sessionId)
  checkpoint += 1

  revisions.delete(key)
  revisions.set(key, checkpoint)

  while (revisions.size > MAX_TRACKED_SESSIONS) {
    const oldest = revisions.keys().next().value

    if (oldest === undefined) {
      break
    }

    revisions.delete(oldest)
  }
}
