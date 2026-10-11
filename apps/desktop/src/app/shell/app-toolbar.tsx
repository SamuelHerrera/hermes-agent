import type { ReactNode } from 'react'

export interface ToolbarEntry {
  id: string
  node: ReactNode
}

/** Fixed-order actions. The enclosing header owns horizontal scrolling. */
export function AppToolbar({ entries }: { entries: ToolbarEntry[] }) {
  return (
    <span className="inline-flex shrink-0 items-center">
      {entries.map(entry => (
        <span className="relative inline-flex shrink-0" data-header-action={entry.id} key={entry.id}>
          {entry.node}
        </span>
      ))}
    </span>
  )
}
