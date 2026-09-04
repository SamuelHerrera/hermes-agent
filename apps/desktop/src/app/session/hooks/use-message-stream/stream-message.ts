import type { ChatMessage } from '@/lib/chat-messages'

/**
 * Update the active streaming message without scanning and rebuilding the full
 * transcript on every token flush.
 *
 * The stream is normally the tail, so that hot path is O(1). Interim sealing
 * and recovery can leave it earlier in history; that path performs one reverse
 * lookup and replaces only the matched slot. A missing stream is appended.
 */
export function upsertStreamMessage(
  messages: ChatMessage[],
  streamId: string,
  create: () => ChatMessage,
  update: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  const tailIndex = messages.length - 1
  let streamIndex = tailIndex >= 0 && messages[tailIndex]?.id === streamId ? tailIndex : -1

  if (streamIndex < 0) {
    for (let index = tailIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.id === streamId) {
        streamIndex = index
        break
      }
    }
  }

  if (streamIndex < 0) {
    return [...messages, create()]
  }

  const current = messages[streamIndex]

  if (!current) {
    return messages
  }

  const replacement = update(current)

  if (replacement === current) {
    return messages
  }

  const next = messages.slice()
  next[streamIndex] = replacement

  return next
}
