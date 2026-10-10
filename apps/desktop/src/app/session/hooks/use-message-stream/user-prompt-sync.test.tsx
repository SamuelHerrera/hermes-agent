import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { chatMessageText, textPart } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import type { RpcEvent } from '@/types/hermes'

import { useMessageStream } from './index'

interface Client {
  handle?: (event: RpcEvent) => void
  states: Map<string, ClientSessionState>
}

function Harness({ client }: { client: Client }) {
  const activeSessionIdRef = useRef<string | null>('shared')
  const statesRef = useRef(client.states)
  const queryClient = useRef(new QueryClient())

  const stream = useMessageStream({
    activeSessionIdRef,
    sessionStateByRuntimeIdRef: statesRef,
    queryClient: queryClient.current,
    hydrateFromStoredSession: vi.fn(async () => undefined),
    refreshHermesConfig: vi.fn(async () => undefined),
    refreshSessions: vi.fn(async () => undefined),
    updateSessionState: (sid, updater) => {
      const next = updater(client.states.get(sid) ?? createClientSessionState())
      client.states.set(sid, next)

      return next
    }
  })

  useEffect(() => { client.handle = stream.handleGatewayEvent }, [client, stream.handleGatewayEvent])

  return null
}

const prompt = (id: string, text: string, status = 'streaming', sid = 'shared'): RpcEvent => ({
  type: 'prompt.accepted', session_id: sid, payload: { message_id: id, text, status }
})

async function mountClients() {
  const desktop: Client = { states: new Map() }
  const mobile: Client = { states: new Map() }
  render(<><Harness client={desktop} /><Harness client={mobile} /></>)
  await waitFor(() => expect(desktop.handle && mobile.handle).toBeTruthy())

  return [desktop, mobile]
}

function seedLocal(client: Client, id: string, text: string) {
  const state = client.states.get('shared') ?? createClientSessionState()
  client.states.set('shared', { ...state, messages: [...state.messages, { id, role: 'user', parts: [textPart(text)] }] })
}

const users = (client: Client, sid = 'shared') =>
  (client.states.get(sid)?.messages ?? []).filter(m => m.role === 'user').map(chatMessageText)

function broadcast(clients: Client[], event: RpcEvent) {
  act(() => {
    for (const client of clients) {
      client.handle!(event)
    }
  })
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('cross-device user prompt synchronization', () => {
  it('mirrors prompts in both directions immediately and does not duplicate the sender or replay', async () => {
    const clients = await mountClients()
    seedLocal(clients[0], 'desktop-send', 'from desktop')
    broadcast(clients, prompt('desktop-send', 'from desktop'))
    broadcast(clients, prompt('desktop-send', 'from desktop'))
    seedLocal(clients[1], 'mobile-send', 'from mobile')
    broadcast(clients, prompt('mobile-send', 'from mobile'))

    for (const client of clients) {
      expect(users(client)).toEqual(['from desktop', 'from mobile'])
    }
  })

  it('keeps identical consecutive prompts distinct and syncs queued and steering input', async () => {
    const clients = await mountClients()

    for (const [id, status] of [['one', 'queued'], ['two', 'redirected'], ['three', 'steered']]) {
      broadcast(clients, prompt(id, 'continue', status))
    }

    for (const client of clients) {
      expect(users(client)).toEqual(['continue', 'continue', 'continue'])
    }
  })

  it('updates only the event session and preserves active assistant output', async () => {
    const clients = await mountClients()
    const state = createClientSessionState()
    clients[1].states.set('shared', {
      ...state, streamId: 'answer', busy: true,
      messages: [{ id: 'answer', role: 'assistant', pending: true, parts: [textPart('working')] }]
    })
    broadcast(clients, prompt('background', 'other chat', 'streaming', 'other'))
    expect(users(clients[1])).toEqual([])
    expect(users(clients[1], 'other')).toEqual(['other chat'])
    broadcast(clients, prompt('correction', 'change direction', 'redirected'))
    expect(clients[1].states.get('shared')?.messages.map(message => message.id)).toEqual(['correction', 'answer'])
    expect(clients[1].states.get('shared')?.streamId).toBe('answer')
  })
})
