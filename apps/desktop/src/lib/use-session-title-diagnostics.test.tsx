import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sessionTitle } from '@/lib/chat-runtime'
import { sessionTitleDiagnostic } from '@/lib/session-title-diagnostics'
import { useSessionTitleDiagnostics } from '@/lib/use-session-title-diagnostics'
import type { SessionInfo } from '@/types/hermes'

const row = (overrides: Partial<SessionInfo> = {}) => ({
  id: 'child', profile: 'default', source: 'subagent', delegate_parent_session_id: 'parent',
  title: null, preview: null, ...overrides
}) as SessionInfo

afterEach(() => vi.unstubAllGlobals())

describe('session title diagnostics', () => {
  it('describes the real title resolver without recording content', () => {
    for (const session of [row(), row({ title: 'Unknown', preview: 'private prompt' }), row({ title: 'private title' })]) {
      const diagnostic = sessionTitleDiagnostic(session, sessionTitle(session))
      expect(diagnostic.displayedFallback).toBe(diagnostic.resolvedFrom === 'fallback')
      expect(JSON.stringify(diagnostic)).not.toContain('private')
      expect(diagnostic.parentSessionId).toBe('parent')
    }
    expect(sessionTitleDiagnostic(undefined).rowPresent).toBe(false)
  })

  it('reports delayed fallback, recovery and selection without logging repeated renders', () => {
    const reportRendererDiagnostic = vi.fn()

    vi.stubGlobal('hermesDesktop', { reportRendererDiagnostic })
    const initial = row({ title: 'private title' })
    const { rerender } = renderHook(({ session, selected }) => {
      useSessionTitleDiagnostics('sidebar', session, sessionTitle(session), selected)
    }, { initialProps: { session: initial, selected: false } })

    expect(reportRendererDiagnostic).toHaveBeenCalledTimes(1)
    rerender({ session: { ...initial, input_tokens: 500 }, selected: false })
    expect(reportRendererDiagnostic).toHaveBeenCalledTimes(1)
    rerender({ session: row(), selected: true })

    expect(reportRendererDiagnostic).toHaveBeenLastCalledWith(expect.objectContaining({
      area: 'session-title', event: 'surface.changed', details: expect.objectContaining({
        before: expect.objectContaining({ displayedFallback: false }),
        after: expect.objectContaining({ displayedFallback: true, selected: true })
      })
    }))
    rerender({ session: initial, selected: true })
    expect(reportRendererDiagnostic).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(reportRendererDiagnostic.mock.calls)).not.toContain('private title')
  })
})
