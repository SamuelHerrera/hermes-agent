import type { KanbanTask } from './types'

const UNREAD_CARD_STATUSES = new Set(['blocked', 'done', 'review'])

export function isUnreadAttentionCard(task: Pick<KanbanTask, 'is_unread' | 'status'>): boolean {
  return task.is_unread === true && UNREAD_CARD_STATUSES.has(task.status)
}
