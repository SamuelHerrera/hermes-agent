/**
 * Always-on local UAT lifecycle diagnostics.
 *
 * Samuel runs the packaged Desktop as the production-shaped UAT surface while
 * this fork changes frequently. Stable state-transition events therefore go to
 * desktop.log in every build, not only Vite dev mode. Callers must send ids,
 * booleans, counts, and enum-like reasons only — never prompts, credentials,
 * filesystem paths, or message content. Electron applies a second redaction and
 * size clamp at the IPC boundary.
 */

const startedAt = typeof performance !== 'undefined' ? performance.now() : 0

const runId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 12)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

let sequence = 0

export function logUatEvent(area: string, event: string, details: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') {
    return
  }

  const report = window.hermesDesktop?.reportRendererDiagnostic

  if (!report) {
    return
  }

  sequence += 1
  report({
    area,
    details,
    elapsedMs: Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - startedAt)),
    event,
    runId,
    seq: sequence
  })
}