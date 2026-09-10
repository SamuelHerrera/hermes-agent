import type { SessionInfo } from '@/hermes'
import { Codecs, persistentAtom } from '@/lib/persisted'

export interface ProjectSessionOrder {
  ids: string[]
  newestCreatedAt: number
}

export const $projectSessionOrders = persistentAtom<Record<string, ProjectSessionOrder>>(
  'hermes.desktop.projectSessionOrders.v1',
  {},
  Codecs.json(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {return {}}

    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => {
        const order = entry as Partial<ProjectSessionOrder> | null

        return (
          order &&
          Array.isArray(order.ids) &&
          order.ids.every(id => typeof id === 'string') &&
          Number.isFinite(order.newestCreatedAt)
        )
      })
    )
  })
)

export const projectSessionIdentity = (session: SessionInfo) => session._lineage_root_id || session.id

/** No manual order means the existing last-updated order still wins. Once
 * dragged, only newly CREATED chats prepend; activity cannot shuffle known rows. */
export function orderProjectSessions(items: SessionInfo[], order?: ProjectSessionOrder): SessionInfo[] {
  if (!order?.ids.length) {return items}
  const rank = new Map(order.ids.map((id, index) => [id, index]))

  const fresh = items
    .filter(item => !rank.has(projectSessionIdentity(item)) && (item.started_at || 0) > order.newestCreatedAt)
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0))

  const freshIds = new Set(fresh.map(item => item.id))

  const rest = items
    .filter(item => !freshIds.has(item.id))
    .sort(
      (a, b) => (rank.get(projectSessionIdentity(a)) ?? Infinity) - (rank.get(projectSessionIdentity(b)) ?? Infinity)
    )

  return [...fresh, ...rest]
}

/** Reordering a filtered/partial lane must not discard the saved hidden rows. */
export function saveProjectSessionOrder(key: string, items: SessionInfo[], draggedIds: string[]): void {
  const previous = $projectSessionOrders.get()[key]
  const byId = new Map(items.map(item => [item.id, item]))
  const ids = [...new Set(draggedIds.map(id => (byId.has(id) ? projectSessionIdentity(byId.get(id)!) : id)))]
  const visible = new Set(ids)
  const old = previous?.ids ?? []
  const existing = new Set(old)
  const template = [...ids.filter(id => !existing.has(id)), ...old]
  let index = 0
  const merged = template.map(id => (visible.has(id) ? ids[index++] : id))
  $projectSessionOrders.set({
    ...$projectSessionOrders.get(),
    [key]: {
      ids: merged,
      newestCreatedAt: Math.max(previous?.newestCreatedAt ?? 0, ...items.map(item => item.started_at || 0))
    }
  })
}
