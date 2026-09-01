import { useEffect } from 'react'

import { getLatestSessionMessages, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS } from '@/hermes'
import { toChatMessages } from '@/lib/chat-messages'
import { isMissingRpcMethod } from '@/lib/gateway-rpc'
import { recoverInFlightTurnJournal } from '@/lib/inflight-turn-journal'
import { dropSessionState, publishSessionState, setSessionTileDelegate } from '@/store/session-states'
import type { SessionResumeResponse } from '@/types/hermes'

import type { usePromptActions } from '../../session/hooks/use-prompt-actions'
import { withSessionNotFoundResume } from '../../session/hooks/use-prompt-actions/utils'
import {
  appendLiveSessionProjection,
  applyRuntimeInfo,
  hydrateSessionTodosFromMessages,
  hydrateSessionTodosFromResume,
  isSessionGoneError,
  resolveSessionProfile
} from '../../session/hooks/use-session-actions/utils'
import type { useSessionStateCache } from '../../session/hooks/use-session-state-cache'
import type { GatewayRequester } from '../types'

type SessionStateCache = ReturnType<typeof useSessionStateCache>

interface SessionTileDelegateParams {
  archiveSession: (storedSessionId: string) => Promise<unknown>
  branchStoredSession: (storedSessionId: string) => Promise<unknown>
  executeSlashCommand: ReturnType<typeof usePromptActions>['executeSlashCommand']
  removeSession: (storedSessionId: string) => Promise<unknown>
  requestGateway: GatewayRequester
  runtimeIdByStoredSessionIdRef: SessionStateCache['runtimeIdByStoredSessionIdRef']
  sessionStateByRuntimeIdRef: SessionStateCache['sessionStateByRuntimeIdRef']
  updateSessionState: SessionStateCache['updateSessionState']
}

/**
 * Publishes the session-tile delegate: resume / submit / interrupt / slash for
 * tiled sessions WITHOUT touching the primary view ($activeSessionId /
 * $messages stay the main thread's). Resume reuses a live runtime binding when
 * one exists (incl. the main thread's own session); a cold tile binds +
 * hydrates the cache, which publishSessionState mirrors to the tile.
 */
export function useSessionTileDelegate({
  archiveSession,
  branchStoredSession,
  executeSlashCommand,
  removeSession,
  requestGateway,
  runtimeIdByStoredSessionIdRef,
  sessionStateByRuntimeIdRef,
  updateSessionState
}: SessionTileDelegateParams): void {
  useEffect(() => {
    // A tile's runtime binding can die the same way the foreground's does
    // (sleep/wake, backend restart). The cache maps stored -> runtime, so walk
    // it backwards to find the durable id this runtime belongs to.
    const storedSessionIdForRuntime = (runtimeId: string): null | string => {
      const cached = sessionStateByRuntimeIdRef.current.get(runtimeId)?.storedSessionId

      if (cached) {
        return cached
      }

      for (const [storedId, mapped] of runtimeIdByStoredSessionIdRef.current) {
        if (mapped === runtimeId) {
          return storedId
        }
      }

      return null
    }

    // Repoint the stored -> runtime mapping at the recovered id so subsequent
    // tile actions use the live binding instead of re-recovering every call.
    const rebindTileRuntime = (deadRuntimeId: string) => (recoveredId: string) => {
      const storedId = storedSessionIdForRuntime(deadRuntimeId)

      if (storedId) {
        runtimeIdByStoredSessionIdRef.current.set(storedId, recoveredId)
      }
    }

    setSessionTileDelegate({
      archiveSession: async storedSessionId => {
        await archiveSession(storedSessionId)
      },
      branchSession: async storedSessionId => {
        await branchStoredSession(storedSessionId)
      },
      deleteSession: async storedSessionId => {
        await removeSession(storedSessionId)
      },
      executeSlash: async (rawCommand, sessionId) => {
        await executeSlashCommand(rawCommand, { sessionId })
      },
      interruptSession: async runtimeId => {
        await withSessionNotFoundResume(
          runtimeId,
          storedSessionIdForRuntime(runtimeId),
          liveId => requestGateway('session.interrupt', { session_id: liveId }),
          { requestGateway, onRecovered: rebindTileRuntime(runtimeId) }
        )
      },
      resumeTile: async storedSessionId => {
        const existing = runtimeIdByStoredSessionIdRef.current.get(storedSessionId)
        const cached = existing ? sessionStateByRuntimeIdRef.current.get(existing) : undefined

        // Resolve the owning profile before binding or re-activating a runtime.
        // A tile can open a session from any profile, not just the active one.
        const profile = await resolveSessionProfile(storedSessionId)
        const prefetchPromise = getLatestSessionMessages(storedSessionId, profile).catch(() => null)

        if (existing && cached?.storedSessionId === storedSessionId) {
          try {
            // A renderer reconnect does not prove this runtime still exists: an
            // always-on backend restart re-mints every runtime id while Desktop's
            // cache survives. Re-activate first so the live session transport is
            // rebound on an ordinary socket reconnect, and fall through to a
            // durable session.resume when the old backend/runtime died.
            const activated = await requestGateway<SessionResumeResponse>('session.activate', {
              session_id: existing,
              cols: 96,
              omit_messages: true
            })

            const activatedStoredId = activated.session_key || activated.resumed

            if (activatedStoredId && activatedStoredId !== storedSessionId) {
              runtimeIdByStoredSessionIdRef.current.delete(storedSessionId)
              sessionStateByRuntimeIdRef.current.delete(existing)
              dropSessionState(existing)
            } else {
              const running = Boolean(activated.running ?? activated.info?.running)
              const persisted = await prefetchPromise

              const baseMessages =
                !running && persisted ? toChatMessages(persisted.messages) : cached.messages

              const hasLiveProjection = Boolean(activated.inflight || activated.queued || activated.pending_prompt)

              const projectedMessages = hasLiveProjection
                ? appendLiveSessionProjection(baseMessages, activated)
                : baseMessages

              const recovery = recoverInFlightTurnJournal(storedSessionId, projectedMessages, {
                keepPending: running
              })

              const runtimeInfo = applyRuntimeInfo(activated.info, { foreground: false })

              hydrateSessionTodosFromResume({ ...activated, running })

              if (recovery.applied) {
                hydrateSessionTodosFromMessages(existing, recovery.messages, { allowActive: running })
              }

              updateSessionState(
                existing,
                state => ({
                  ...state,
                  ...(runtimeInfo ?? {}),
                  adoptedRunningTurn: state.adoptedRunningTurn || running,
                  awaitingResponse: running && !recovery.applied,
                  busy: running,
                  messages: recovery.messages,
                  ...(recovery.applied
                    ? {
                        sawAssistantPayload: true,
                        streamId: running ? recovery.streamId : null,
                        turnStartedAt: running
                          ? (recovery.turnStartedAt ?? state.turnStartedAt ?? Date.now())
                          : null
                      }
                    : { streamId: running ? state.streamId : null, turnStartedAt: running ? state.turnStartedAt : null })
                }),
                storedSessionId
              )

              return existing
            }
          } catch (error) {
            if (isMissingRpcMethod(error)) {
              publishSessionState(existing, cached)

              return existing
            }

            if (!isSessionGoneError(error)) {
              throw error
            }

            runtimeIdByStoredSessionIdRef.current.delete(storedSessionId)
            sessionStateByRuntimeIdRef.current.delete(existing)
            dropSessionState(existing)
          }
        }

        const [prefetch, resumed] = await Promise.all([
          prefetchPromise,
          requestGateway<SessionResumeResponse>('session.resume', {
            session_id: storedSessionId,
            cols: 96,
            omit_messages: true,
            ...(profile ? { profile } : {})
          })
        ])

        const runtimeId = resumed?.session_id

        if (!runtimeId) {
          throw new Error('resume returned no session id')
        }

        const resumedRunning = Boolean(resumed.running ?? resumed.info?.running)
        const runtimeInfo = applyRuntimeInfo(resumed.info, { foreground: false })
        const baseMessages = toChatMessages(prefetch?.messages ?? resumed.messages ?? [])
        const hasLiveProjection = Boolean(resumed.inflight || resumed.queued || resumed.pending_prompt)
        const projectedMessages = hasLiveProjection ? appendLiveSessionProjection(baseMessages, resumed) : baseMessages
        const recovery = recoverInFlightTurnJournal(storedSessionId, projectedMessages, { keepPending: resumedRunning })

        hydrateSessionTodosFromResume({ ...resumed, running: resumedRunning })

        if (recovery.applied) {
          hydrateSessionTodosFromMessages(runtimeId, recovery.messages, { allowActive: resumedRunning })
        }

        updateSessionState(
          runtimeId,
          state => ({
            ...state,
            ...(runtimeInfo ?? {}),
            adoptedRunningTurn: state.adoptedRunningTurn || resumedRunning,
            awaitingResponse: resumedRunning && !recovery.applied,
            busy: resumedRunning,
            messages: state.messages.length > 0 ? state.messages : recovery.messages,
            ...(recovery.applied
              ? {
                  sawAssistantPayload: true,
                  streamId: resumedRunning ? recovery.streamId : null,
                  turnStartedAt: resumedRunning
                    ? (recovery.turnStartedAt ?? state.turnStartedAt ?? Date.now())
                    : state.turnStartedAt
                }
              : {})
          }),
          storedSessionId
        )

        return runtimeId
      },
      submitToSession: async (runtimeId, text) => {
        await withSessionNotFoundResume(
          runtimeId,
          storedSessionIdForRuntime(runtimeId),
          liveId => requestGateway('prompt.submit', { session_id: liveId, text }, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS),
          { requestGateway, onRecovered: rebindTileRuntime(runtimeId) }
        )
      },
      updateSession: (runtimeId, updater) => updateSessionState(runtimeId, updater)
    })
  }, [
    archiveSession,
    branchStoredSession,
    executeSlashCommand,
    removeSession,
    requestGateway,
    runtimeIdByStoredSessionIdRef,
    sessionStateByRuntimeIdRef,
    updateSessionState
  ])
}
