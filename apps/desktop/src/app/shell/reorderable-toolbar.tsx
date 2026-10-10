import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type ReactNode, useRef } from 'react'

import { storedStringArray, writeJson } from '@/lib/storage'

const ORDER_KEY = 'hermes.global.headerActionOrder.v1'
const $order = atom(storedStringArray(ORDER_KEY))

export interface ToolbarEntry {
  id: string
  node: ReactNode
}

export function orderToolbarEntries(entries: ToolbarEntry[], order: string[]): ToolbarEntry[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]))

  return [...new Set([...order, ...byId.keys()])].flatMap(id => {
    const entry = byId.get(id)

    return entry ? [entry] : []
  })
}

function SortableAction({ entry }: { entry: ToolbarEntry }) {
  const { attributes, isDragging, listeners, setNodeRef, transform } = useSortable({ id: entry.id })

  return (
    <span
      {...attributes}
      {...listeners}
      aria-label={`Reorder ${entry.id}`}
      className="relative inline-flex shrink-0"
      data-header-action={entry.id}
      ref={setNodeRef}
      role="group"
      style={{ transform: transform ? `translateX(${transform.x}px)` : undefined, zIndex: isDragging ? 20 : undefined }}
    >
      {entry.node}
    </span>
  )
}

export function ReorderableToolbar({ entries }: { entries: ToolbarEntry[] }) {
  const savedOrder = useStore($order)
  const ordered = orderToolbarEntries(entries, savedOrder)
  const ids = ordered.map(entry => entry.id)
  const suppressClick = useRef(false)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragCancel={() => {
        suppressClick.current = false
      }}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) {
          const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
          $order.set(next)
          writeJson(ORDER_KEY, next)
        }

        window.setTimeout(() => {
          suppressClick.current = false
        }, 0)
      }}
      onDragStart={() => {
        suppressClick.current = true
      }}
      sensors={sensors}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <span
          className="inline-flex shrink-0 items-center"
          onClickCapture={event => {
            if (suppressClick.current) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
        >
          {ordered.map(entry => (
            <SortableAction entry={entry} key={entry.id} />
          ))}
        </span>
      </SortableContext>
    </DndContext>
  )
}
