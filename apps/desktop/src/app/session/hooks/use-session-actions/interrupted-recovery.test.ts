import { describe, expect, it } from 'vitest'

import { appendLiveSessionProjection } from './utils'

describe('interrupted recovery projection', () => {
  it('renders a stable manual-continue error row without claiming work is running', () => {
    const projection = {
      inflight: null,
      pending_prompt: null,
      queued: null,
      running: false,
      session_id: 'runtime',
      recovery: {
        state: 'interrupted' as const,
        source: 'raw_transcript' as const,
        reason: 'missing_marker',
        needs_manual_continue: true,
        interrupted_at: 1
      }
    }
    const rows = appendLiveSessionProjection([], projection)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('assistant-recovery-runtime')
    expect(rows[0].error).toContain('Interrupted turn')
    expect(rows[0].pending).toBeFalsy()
    expect(appendLiveSessionProjection(rows, projection)).toHaveLength(1)
  })

  it.each([
    ['missing_marker', 'recovery marker is missing'],
    ['stale', 'configured recovery window expired'],
    ['exhausted', 'automatic recovery attempt limit'],
    ['lease_unavailable', 'turn ownership could not be verified'],
    ['storage_error', 'JSONDecodeError: invalid recovery state']
  ])('shows the actual %s recovery failure', (reason, expected) => {
    const rows = appendLiveSessionProjection([], {
      session_id: 'runtime', running: false,
      inflight: null, queued: null, pending_prompt: null,
      recovery: {
        state: 'interrupted', source: 'marker', reason,
        error: reason === 'storage_error' ? expected : undefined,
        needs_manual_continue: true, interrupted_at: 1
      }
    })
    expect(rows[0].error).toContain(expected)
    expect(rows[0].error).toContain(reason)
  })
})
