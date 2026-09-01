import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import type * as HermesModule from '@/hermes'
import type { ChatMessage } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { setSessions } from '@/store/session'
import { sessionTileDelegate } from '@/store/session-states'
import { $todosBySession, clearSessionTodos } from '@/store/todos'
import type { SessionInfo } from '@/types/hermes'

import { useSessionTileDelegate } from './use-session-tile-delegate'

vi.mock('@/hermes', async importActual => ({
  ...(await importActual<typeof HermesModule>()),
  getLatestSessionMessages: vi.fn(async () => ({ messages: [], session_id: '' }))
}))

const { getLatestSessionMessages } = await import('@/hermes')

const row = (over: Partial<SessionInfo>): SessionInfo =>
  ({
    ended_at: null,
    id: 'live',
    input_tokens: 0,
    is_active: false,
    last_active: 0,
    message_count: 1,
    model: null,
    output_tokens: 0,
    preview: null,
    profile: 'default',
    source: null,
    started_at: 0,
    title: null,
    ...over
  }) as SessionInfo

const todoToolMessage = (toolCallId = 'todo-1'): ChatMessage => ({
  id: 'assistant-stream-runtime-1',
  parts: [
    {
      result: {
        todos: [
          { content: 'Inspect code', id: 'a', status: 'completed' },
          { content: 'Patch root cause', id: 'b', status: 'in_progress' }
        ]
      },
      toolCallId,
      toolName: 'todo',
      type: 'tool-call'
    },
    { text: 'Working on it', type: 'text' }
  ],
  role: 'assistant'
})

function renderTile(
  requestGateway: ReturnType<typeof vi.fn>,
  updateSessionState: (sessionId: string, updater: (state: ClientSessionState) => ClientSessionState) => void = vi.fn(),
  cache: {
    runtimeIdByStoredSessionId?: Map<string, string>
    sessionStateByRuntimeId?: Map<string, ClientSessionState>
  } = {}
) {
  renderHook(() =>
    useSessionTileDelegate({
      archiveSession: vi.fn(async () => undefined),
      branchStoredSession: vi.fn(async () => undefined),
      executeSlashCommand: vi.fn(async () => undefined) as never,
      removeSession: vi.fn(async () => undefined),
      requestGateway: requestGateway as never,
      runtimeIdByStoredSessionIdRef: { current: cache.runtimeIdByStoredSessionId ?? new Map() },
      sessionStateByRuntimeIdRef: { current: cache.sessionStateByRuntimeId ?? new Map() },
      updateSessionState: updateSessionState as never
    })
  )
}

describe('useSessionTileDelegate resumeTile', () => {
  beforeEach(() => {
    setSessions([])
    clearSessionTodos('runtime-1')
    clearSessionTodos('runtime-2')
    vi.mocked(getLatestSessionMessages).mockClear()
  })

  afterEach(() => {
    setSessions([])
    clearSessionTodos('runtime-1')
    clearSessionTodos('runtime-2')
    window.localStorage.clear()
  })

  it('carries the owning profile into a cold tile resume so it cannot fork profiles', async () => {
    // A tile opens a session owned by another profile. Resuming without the
    // profile lets the gateway fall back to the launch-profile DB and clone the
    // conversation into the wrong profile (#67603). The owning profile must ride
    // both the transcript prefetch and the resume RPC.
    setSessions([row({ id: 'stored-x', profile: 'ai-engineer' })])

    const requestGateway = vi.fn(async (method: string) =>
      method === 'session.resume' ? ({ session_id: 'runtime-1' } as never) : ({} as never)
    )

    renderTile(requestGateway)
    const runtimeId = await sessionTileDelegate()!.resumeTile('stored-x')

    expect(runtimeId).toBe('runtime-1')
    expect(getLatestSessionMessages).toHaveBeenCalledWith('stored-x', 'ai-engineer')
    expect(requestGateway).toHaveBeenCalledWith('session.resume', {
      session_id: 'stored-x',
      cols: 96,
      profile: 'ai-engineer',
      omit_messages: true
    })
  })

  it('resolves and carries a default-profile session explicitly', async () => {
    setSessions([row({ id: 'stored-y', profile: 'default' })])

    const requestGateway = vi.fn(async (method: string) =>
      method === 'session.resume' ? ({ session_id: 'runtime-2' } as never) : ({} as never)
    )

    renderTile(requestGateway)
    await sessionTileDelegate()!.resumeTile('stored-y')

    expect(requestGateway).toHaveBeenCalledWith('session.resume', {
      session_id: 'stored-y',
      cols: 96,
      profile: 'default',
      omit_messages: true
    })
  })

  it('re-activates a cached tile runtime so a reconnected socket receives live events', async () => {
    setSessions([row({ id: 'stored-live', profile: 'default' })])

    const cachedState = createClientSessionState('stored-live')

    cachedState.awaitingResponse = true
    cachedState.busy = true

    const restored: ClientSessionState[] = []

    const updateSessionState = vi.fn(
      (_sessionId: string, updater: (state: ClientSessionState) => ClientSessionState) => {
        restored.push(updater(cachedState))
      }
    )

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.activate') {
        return {
          messages: [],
          running: false,
          session_id: 'runtime-live',
          session_key: 'stored-live'
        } as never
      }

      throw new Error(`unexpected ${method}`)
    })

    renderTile(requestGateway, updateSessionState, {
      runtimeIdByStoredSessionId: new Map([['stored-live', 'runtime-live']]),
      sessionStateByRuntimeId: new Map([['runtime-live', cachedState]])
    })

    const runtimeId = await sessionTileDelegate()!.resumeTile('stored-live')

    expect(requestGateway).toHaveBeenCalledTimes(1)
    expect(requestGateway).toHaveBeenCalledWith('session.activate', {
      cols: 96,
      omit_messages: true,
      session_id: 'runtime-live'
    })
    expect(runtimeId).toBe('runtime-live')
    expect(restored[0]).toMatchObject({ awaitingResponse: false, busy: false })
  })

  it('falls through to a cold resume when a cached tile runtime died with the backend', async () => {
    setSessions([row({ id: 'stored-restarted', profile: 'default' })])

    const cachedState = createClientSessionState('stored-restarted')
    cachedState.busy = true

    const runtimeIdByStoredSessionId = new Map([['stored-restarted', 'runtime-dead']])
    const sessionStateByRuntimeId = new Map([['runtime-dead', cachedState]])

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.activate') {
        throw new Error('Session not found: runtime-dead')
      }

      if (method === 'session.resume') {
        return {
          messages: [],
          resumed: 'stored-restarted',
          running: false,
          session_id: 'runtime-recovered'
        } as never
      }

      return {} as never
    })

    renderTile(requestGateway, vi.fn(), {
      runtimeIdByStoredSessionId,
      sessionStateByRuntimeId
    })

    const runtimeId = await sessionTileDelegate()!.resumeTile('stored-restarted')

    expect(requestGateway).toHaveBeenNthCalledWith(1, 'session.activate', {
      cols: 96,
      omit_messages: true,
      session_id: 'runtime-dead'
    })
    expect(requestGateway).toHaveBeenNthCalledWith(2, 'session.resume', {
      cols: 96,
      omit_messages: true,
      profile: 'default',
      session_id: 'stored-restarted'
    })
    expect(runtimeId).toBe('runtime-recovered')
  })

  it('rebuilds the composer task list for a cold restored tile from resume events', async () => {
    setSessions([row({ id: 'stored-todo', profile: 'default' })])
    vi.mocked(getLatestSessionMessages).mockResolvedValueOnce({ messages: [], session_id: 'stored-todo' })

    const restored: ClientSessionState[] = []

    const updateSessionState = vi.fn((_sessionId: string, updater: (state: ClientSessionState) => ClientSessionState) => {
      restored.push(updater(createClientSessionState('stored-todo')))
    })

    const requestGateway = vi.fn(async (method: string) =>
      method === 'session.resume'
        ? {
            inflight: {
              assistant: 'Working on it',
              events: [
                {
                  payload: {
                    name: 'todo',
                    result: {
                      todos: [
                        { content: 'Inspect code', id: 'a', status: 'completed' },
                        { content: 'Patch root cause', id: 'b', status: 'in_progress' }
                      ]
                    },
                    todos: [
                      { content: 'Inspect code', id: 'a', status: 'completed' },
                      { content: 'Patch root cause', id: 'b', status: 'in_progress' }
                    ],
                    tool_id: 'todo-1'
                  },
                  type: 'tool.complete'
                }
              ],
              streaming: true,
              user: 'ship it'
            },
            message_count: 1,
            messages: [],
            resumed: 'stored-todo',
            running: true,
            session_id: 'runtime-1'
          }
        : ({} as never)
    )

    renderTile(requestGateway, updateSessionState)
    await sessionTileDelegate()!.resumeTile('stored-todo')

    expect($todosBySession.get()['runtime-1']).toEqual([
      { content: 'Inspect code', id: 'a', status: 'completed' },
      { content: 'Patch root cause', id: 'b', status: 'in_progress' }
    ])
    const state = restored[0]

    expect(state?.busy).toBe(true)
    expect(state?.awaitingResponse).toBe(true)
    expect(state?.messages.some(message => message.parts.some(part => part.type === 'tool-call'))).toBe(true)
  })

  it('rebuilds the composer task list for a cold restored tile from the local in-flight journal', async () => {
    setSessions([row({ id: 'stored-journal', profile: 'default' })])
    vi.mocked(getLatestSessionMessages).mockResolvedValueOnce({ messages: [], session_id: 'stored-journal' })
    window.localStorage.setItem(
      'hermes.desktop.inflightTurnJournal.v2:stored-journal',
      JSON.stringify({
        messages: [{ id: 'u1', parts: [{ text: 'ship it', type: 'text' }], role: 'user' }, todoToolMessage()],
        streamId: 'assistant-stream-runtime-1',
        turnStartedAt: 123,
        updatedAt: Date.now()
      })
    )

    const restored: ClientSessionState[] = []

    const updateSessionState = vi.fn((_sessionId: string, updater: (state: ClientSessionState) => ClientSessionState) => {
      restored.push(updater(createClientSessionState('stored-journal')))
    })

    const requestGateway = vi.fn(async (method: string) =>
      method === 'session.resume'
        ? {
            message_count: 1,
            messages: [],
            resumed: 'stored-journal',
            running: true,
            session_id: 'runtime-2'
          }
        : ({} as never)
    )

    renderTile(requestGateway, updateSessionState)
    await sessionTileDelegate()!.resumeTile('stored-journal')

    expect($todosBySession.get()['runtime-2']).toEqual([
      { content: 'Inspect code', id: 'a', status: 'completed' },
      { content: 'Patch root cause', id: 'b', status: 'in_progress' }
    ])
    const state = restored[0]

    expect(state?.awaitingResponse).toBe(false)
    expect(state?.streamId).toBe('assistant-stream-runtime-1')
    expect(state?.messages.some(message => message.parts.some(part => part.type === 'tool-call'))).toBe(true)
  })
})
