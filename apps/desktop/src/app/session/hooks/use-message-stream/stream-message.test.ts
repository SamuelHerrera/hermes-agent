import { describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'

import { upsertStreamMessage } from './stream-message'

const message = (id: string, text: string): ChatMessage => ({
  id,
  parts: [{ text, type: 'text' }],
  role: 'assistant'
})

describe('upsertStreamMessage', () => {
  it('updates the common tail stream without searching the earlier history', () => {
    const history = [message('older', 'old'), message('stream', 'partial')]
    const create = vi.fn(() => message('stream', 'new'))
    const update = vi.fn(current => ({ ...current, pending: true }))

    const next = upsertStreamMessage(history, 'stream', create, update)

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(history[1])
    expect(next).not.toBe(history)
    expect(next[0]).toBe(history[0])
    expect(next[1]?.pending).toBe(true)
  })

  it('finds and replaces a non-tail stream while preserving every other message reference', () => {
    const history = [message('older', 'old'), message('stream', 'partial'), message('sealed', 'tool result')]

    const next = upsertStreamMessage(history, 'stream', () => message('stream', 'new'), current => ({
      ...current,
      pending: false
    }))

    expect(next[0]).toBe(history[0])
    expect(next[1]?.pending).toBe(false)
    expect(next[2]).toBe(history[2])
  })

  it('appends a seeded stream only when the id is absent', () => {
    const history = [message('older', 'old')]
    const seeded = message('stream', 'first token')

    const next = upsertStreamMessage(history, 'stream', () => seeded, current => current)

    expect(next).toEqual([...history, seeded])
    expect(next[0]).toBe(history[0])
  })

  it('preserves the array when the update returns the existing message', () => {
    const history = [message('stream', 'partial')]

    expect(upsertStreamMessage(history, 'stream', () => message('stream', 'new'), current => current)).toBe(history)
  })
})
