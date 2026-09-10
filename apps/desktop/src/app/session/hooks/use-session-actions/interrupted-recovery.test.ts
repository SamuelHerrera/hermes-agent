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
})
