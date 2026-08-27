import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { activeGateway } from '@/store/gateway'
import { applyReaction, QUICK_REACTIONS, toggleMessageReaction } from '@/store/reactions'
import { $activeSessionId } from '@/store/session'
import { $sessionStates, $sessionTiles, clearAllSessionStates, publishSessionState } from '@/store/session-states'
import type { MessageReaction } from '@/types/hermes'

vi.mock('@/store/gateway', () => ({ activeGateway: vi.fn() }))
vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))

const at = 1_700_000_000

function reaction(emoji: string, author: MessageReaction['author']): MessageReaction {
  return { emoji, author, at }
}

describe('applyReaction', () => {
  it('adds a reaction to an empty message', () => {
    expect(applyReaction(undefined, '❤️', 'user')).toMatchObject([{ emoji: '❤️', author: 'user' }])
  })

  it('replaces the same author’s existing reaction (one per author)', () => {
    const next = applyReaction([reaction('❤️', 'user')], '😂', 'user')

    expect(next).toHaveLength(1)
    expect(next[0].emoji).toBe('😂')
  })

  it('retracts when the live reaction is re-sent', () => {
    expect(applyReaction([reaction('👍', 'user')], '👍', 'user')).toEqual([])
  })

  it('clears on an explicit null', () => {
    expect(applyReaction([reaction('👍', 'user')], null, 'user')).toEqual([])
  })

  it('keeps authors independent', () => {
    const next = applyReaction([reaction('🔥', 'agent')], '❤️', 'user')

    expect(next.map(r => r.author).sort()).toEqual(['agent', 'user'])
  })

  it('retracting one author leaves the other intact', () => {
    const next = applyReaction([reaction('🔥', 'agent'), reaction('❤️', 'user')], null, 'user')

    expect(next).toMatchObject([{ emoji: '🔥', author: 'agent' }])
  })

  it('never mutates the input array', () => {
    const before = [reaction('❤️', 'user')]
    const snapshot = [...before]

    applyReaction(before, '😂', 'user')

    expect(before).toEqual(snapshot)
  })
})

describe('QUICK_REACTIONS', () => {
  it('is the six iOS Tapback defaults, each distinct', () => {
    expect(QUICK_REACTIONS).toHaveLength(6)
    expect(new Set(QUICK_REACTIONS).size).toBe(6)
  })
})

describe('toggleMessageReaction', () => {
  beforeEach(() => {
    clearAllSessionStates()
    $activeSessionId.set('primary-runtime')
    $sessionTiles.set([{ runtimeId: 'tile-runtime', storedSessionId: 'stored-tile' }])
    vi.clearAllMocks()
  })

  it('persists and updates through the runtime that owns the message', async () => {
    const message: ChatMessage = {
      id: 'tile-message',
      parts: [{ type: 'text', text: 'from the tile' }],
      reactions: [],
      role: 'assistant',
      rowId: 41
    }

    const request = vi.fn().mockResolvedValue({
      reactions: [{ author: 'user', at, emoji: '❤️' }],
      row_id: 41
    })

    vi.mocked(activeGateway).mockReturnValue({ request } as never)
    publishSessionState('tile-runtime', {
      ...createClientSessionState('stored-tile'),
      messages: [message]
    })

    await toggleMessageReaction(message, '❤️', 'tile-runtime')

    expect(request).toHaveBeenCalledWith('message.react', {
      author: 'user',
      emoji: '❤️',
      row_id: 41,
      session_id: 'tile-runtime'
    })
    expect($sessionStates.get()['tile-runtime']?.messages[0]).toMatchObject({
      reactions: [{ author: 'user', emoji: '❤️' }],
      rowId: 41
    })
  })
})
