import type { SessionInfo } from '@/types/hermes'

/** Describe title resolution without writing titles or prompt previews to disk. */
export function sessionTitleDiagnostic(session: SessionInfo | null | undefined, displayed?: string) {
  const title = session?.title?.trim() || ''
  const preview = session?.preview?.trim() || ''
  const placeholder = /^(unknown|untitled session)$/i.test(title)

  return {
    sessionId: session?.id ?? null,
    profile: session?.profile || 'default',
    parentSessionId: session?.delegate_parent_session_id || null,
    rowPresent: Boolean(session),
    subagent: session?.source === 'subagent' || Boolean(session?.delegate_parent_session_id),
    titlePresent: Boolean(title),
    titlePlaceholder: placeholder,
    previewPresent: Boolean(preview),
    resolvedFrom: title && !placeholder ? 'title' : preview ? 'preview' : 'fallback',
    displayedFallback: displayed === undefined ? null : /^(unknown|untitled session|new session)$/i.test(displayed.trim())
  }
}
