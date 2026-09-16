import {
  $clarifyRequests,
  clearClarifyRequest,
  normalizeChoices,
  setClarifyRequest,
  warnDroppedChoices
} from '@/store/clarify'
import { $mcpSetupRequests, clearMcpSetupRequest, setMcpSetupRequest } from '@/store/mcp-setup'
import { markPendingPromptChanged, pendingPromptChangedSince, pendingPromptCheckpoint, pendingPromptRevision } from '@/store/prompt-revision'
import {
  clearApprovalRequest,
  clearSecretRequest,
  clearSudoRequest,
  sessionApprovalRequest,
  sessionSecretRequest,
  sessionSudoRequest,
  setApprovalRequest,
  setSecretRequest,
  setSudoRequest
} from '@/store/prompts'
import type { SessionResumeResponse } from '@/types/hermes'

/** Terminal metadata invalidates in-flight hydration even if no card mounted yet. */
export function retirePendingPrompt(event: string, requestId: string, sessionId: string): void {
  markPendingPromptChanged(sessionId)

  if (event === 'sudo.request') {clearSudoRequest(sessionId, requestId)}

  if (event === 'secret.request') {clearSecretRequest(sessionId, requestId)}

  if (event === 'approval.request') {clearApprovalRequest(sessionId, requestId)}

  if (event === 'clarify.request') {clearClarifyRequest(requestId, sessionId)}

  if (event === 'mcp.setup.request') {clearMcpSetupRequest(requestId, sessionId)}
}

interface PendingPromptResumeBaseline {
  approvalRequestId?: string
  checkpoint: number
  clarifyRequestId?: string
  mcpSetupRequestId?: string
  revision: number
  secretRequestId?: string
  sessionId: string
  sudoRequestId?: string
}

export function pendingPromptResumeBaseline(
  sessionId: string,
  checkpoint = pendingPromptCheckpoint()
): PendingPromptResumeBaseline {
  return {
    approvalRequestId: sessionApprovalRequest(sessionId).get()?.requestId,
    checkpoint,
    clarifyRequestId: $clarifyRequests.get()[sessionId]?.requestId,
    mcpSetupRequestId: $mcpSetupRequests.get()[sessionId]?.requestId,
    revision: pendingPromptRevision(sessionId),
    secretRequestId: sessionSecretRequest(sessionId).get()?.requestId,
    sessionId,
    sudoRequestId: sessionSudoRequest(sessionId).get()?.requestId
  }
}

function pendingPromptRequestId(event: string | undefined, sessionId: string): string | undefined {
  if (event === 'clarify.request') {
    return $clarifyRequests.get()[sessionId]?.requestId
  }

  if (event === 'approval.request') {
    return sessionApprovalRequest(sessionId).get()?.requestId
  }

  if (event === 'sudo.request') {
    return sessionSudoRequest(sessionId).get()?.requestId
  }

  if (event === 'secret.request') {
    return sessionSecretRequest(sessionId).get()?.requestId
  }

  if (event === 'mcp.setup.request') {
    return $mcpSetupRequests.get()[sessionId]?.requestId
  }

  return undefined
}

function baselineRequestId(event: string | undefined, baseline: PendingPromptResumeBaseline | null): string | undefined {
  if (event === 'clarify.request') {
    return baseline?.clarifyRequestId
  }

  if (event === 'approval.request') {
    return baseline?.approvalRequestId
  }

  if (event === 'sudo.request') {
    return baseline?.sudoRequestId
  }

  if (event === 'secret.request') {
    return baseline?.secretRequestId
  }

  if (event === 'mcp.setup.request') {
    return baseline?.mcpSetupRequestId
  }

  return undefined
}

function clearPendingPromptBaseline(
  baseline: PendingPromptResumeBaseline | null,
  preserveEvent?: string,
  preserveRequestId?: string
): void {
  if (!baseline) {
    return
  }

  const preserve = (event: string, requestId?: string) =>
    Boolean(requestId && preserveEvent === event && preserveRequestId === requestId)

  if (baseline.clarifyRequestId && !preserve('clarify.request', baseline.clarifyRequestId)) {
    clearClarifyRequest(baseline.clarifyRequestId, baseline.sessionId)
  }

  if (baseline.approvalRequestId && !preserve('approval.request', baseline.approvalRequestId)) {
    clearApprovalRequest(baseline.sessionId, baseline.approvalRequestId)
  }

  if (baseline.sudoRequestId && !preserve('sudo.request', baseline.sudoRequestId)) {
    clearSudoRequest(baseline.sessionId, baseline.sudoRequestId)
  }

  if (baseline.secretRequestId && !preserve('secret.request', baseline.secretRequestId)) {
    clearSecretRequest(baseline.sessionId, baseline.secretRequestId)
  }

  if (baseline.mcpSetupRequestId && !preserve('mcp.setup.request', baseline.mcpSetupRequestId)) {
    clearMcpSetupRequest(baseline.mcpSetupRequestId, baseline.sessionId)
  }
}

export function hasPendingPrompt(sessionId: string): boolean {
  return Boolean(
    $clarifyRequests.get()[sessionId] ||
    sessionApprovalRequest(sessionId).get() ||
    sessionSudoRequest(sessionId).get() ||
    sessionSecretRequest(sessionId).get() ||
    $mcpSetupRequests.get()[sessionId]
  )
}

interface PendingPromptHydration {
  needsInput: boolean
  snapshotAccepted: boolean
}

function pendingPromptHydration(needsInput: boolean, snapshotAccepted = false): PendingPromptHydration {
  return { needsInput, snapshotAccepted }
}

export function hydratePendingPromptFromResume(
  resumed: SessionResumeResponse,
  baseline: PendingPromptResumeBaseline | null = null
): PendingPromptHydration {
  const event = resumed.pending_prompt?.event
  const payload = resumed.pending_prompt?.payload

  if (!event || !payload) {
    clearPendingPromptBaseline(baseline)

    return pendingPromptHydration(hasPendingPrompt(resumed.session_id))
  }

  const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
  const currentRequestId = pendingPromptRequestId(event, resumed.session_id)
  const previousRequestId = baselineRequestId(event, baseline)
  const resumedRevision = pendingPromptRevision(resumed.session_id)

  const stateChangedDuringResume = Boolean(
    baseline &&
      (pendingPromptRevision(baseline.sessionId) !== baseline.revision ||
        pendingPromptChangedSince(resumed.session_id, baseline.checkpoint) ||
        (pendingPromptCheckpoint() > baseline.checkpoint && resumedRevision === 0))
  )

  // A live event or resolution is newer than the resume snapshot. Keep an
  // exact still-pending request, but never resurrect one that disappeared or
  // overwrite a newer request of the same kind.
  if (stateChangedDuringResume && (!requestId || currentRequestId !== requestId)) {
    clearPendingPromptBaseline(baseline, event, currentRequestId)

    return pendingPromptHydration(hasPendingPrompt(resumed.session_id))
  }

  if (currentRequestId && requestId && currentRequestId !== requestId && currentRequestId !== previousRequestId) {
    clearPendingPromptBaseline(baseline, event, currentRequestId)

    return pendingPromptHydration(true)
  }

  clearPendingPromptBaseline(baseline, event, requestId)

  if (event === 'clarify.request') {
    const question = typeof payload.question === 'string' ? payload.question : ''
    const rawChoices = payload.choices
    const choices = normalizeChoices(rawChoices)

    if (!requestId || !question) {
      return pendingPromptHydration(hasPendingPrompt(resumed.session_id))
    }

    if (rawChoices != null && choices.length === 0) {
      warnDroppedChoices('gateway', question, rawChoices)
    }

    setClarifyRequest({
      choices: choices.length > 0 ? choices : null,
      question,
      requestId,
      sessionId: resumed.session_id
    })

    return pendingPromptHydration(true, true)
  }

  if (event === 'mcp.setup.request') {
    const server = typeof payload.server === 'string' ? payload.server : ''

    if (!requestId || !server) {
      return pendingPromptHydration(false)
    }

    const rawAction = typeof payload.action === 'string' ? payload.action : 'install'
    const action = rawAction === 'enable' || rawAction === 'authorize' ? rawAction : 'install'
    setMcpSetupRequest({
      action,
      reason: typeof payload.reason === 'string' ? payload.reason : '',
      requestId,
      server,
      sessionId: resumed.session_id
    })

    return pendingPromptHydration(true, true)
  }

  if (event === 'approval.request') {
    setApprovalRequest({
      allowPermanent: payload.allow_permanent !== false,
      choices: Array.isArray(payload.choices)
        ? payload.choices.filter(choice => typeof choice === 'string')
        : undefined,
      command: typeof payload.command === 'string' ? payload.command : '',
      description: typeof payload.description === 'string' ? payload.description : 'dangerous command',
      requestId: requestId || undefined,
      sessionId: resumed.session_id,
      smartDenied: payload.smart_denied === true
    })

    return pendingPromptHydration(true, true)
  }

  if (event === 'sudo.request' && requestId) {
    setSudoRequest({ requestId, sessionId: resumed.session_id })

    return pendingPromptHydration(true, true)
  }

  if (event === 'secret.request' && requestId) {
    setSecretRequest({
      envVar: typeof payload.env_var === 'string' ? payload.env_var : '',
      prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
      requestId,
      sessionId: resumed.session_id
    })

    return pendingPromptHydration(true, true)
  }

  return pendingPromptHydration(false)
}
