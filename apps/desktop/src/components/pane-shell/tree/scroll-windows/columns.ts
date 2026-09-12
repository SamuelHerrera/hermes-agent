export type ScrollDropEdge = 'left' | 'right' | 'top' | 'bottom'

/** Keep explicit stacks, remove closed/duplicate panes, append new panes on the right. */
export function reconcileColumns(columns: readonly (readonly string[])[], windowIds: readonly string[]): string[][] {
  const remaining = new Set(windowIds)
  const next = columns.map(column => column.filter(id => remaining.delete(id))).filter(column => column.length > 0)

  return [...next, ...Array.from(remaining, id => [id])]
}

/** Preserve the positions of the old row-major grid when upgrading persisted workspaces. */
export function legacyColumns(windowIds: readonly string[], rows: number): string[][] {
  const count = Math.ceil(windowIds.length / Math.max(1, Math.min(windowIds.length, Math.floor(rows))))

  return Array.from({ length: count }, (_, column) => windowIds.filter((_, index) => index % count === column))
}

/** A vertical drop changes only the target stack; a horizontal drop extracts a full-height column. */
export function moveColumnWindow(
  columns: readonly (readonly string[])[],
  source: string,
  target: string,
  edge: ScrollDropEdge
): string[][] {
  if (
    source === target ||
    !columns.some(column => column.includes(source)) ||
    !columns.some(column => column.includes(target))
  ) {
    return columns.map(column => [...column])
  }

  const next = columns.map(column => column.filter(id => id !== source)).filter(column => column.length > 0)
  const targetColumn = next.findIndex(column => column.includes(target))

  if (edge === 'left' || edge === 'right') {
    next.splice(targetColumn + (edge === 'right' ? 1 : 0), 0, [source])
  } else {
    const stack = next[targetColumn]
    stack.splice(stack.indexOf(target) + (edge === 'bottom' ? 1 : 0), 0, source)
  }

  return next
}
