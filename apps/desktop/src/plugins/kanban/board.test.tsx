import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { sortColumnTasks, taskTimeLabel, type TaskSortDirection } from './board'
import type { KanbanTask } from './types'

const task = (id: string, created_at: number, priority = 0): KanbanTask => ({
  created_at,
  id,
  priority,
  status: 'done',
  title: id
})

describe('kanban board time sorting', () => {
  it('sorts each column oldest-first by default while keeping priority groups intact', () => {
    const tasks = [task('t_old_low', 100, 0), task('t_new_high', 300, 2), task('t_old_high', 200, 2)]

    expect(sortColumnTasks(tasks, 'asc').map(t => t.id)).toEqual(['t_old_high', 't_new_high', 't_old_low'])
  })

  it('can reverse each column newest-first while keeping priority groups intact', () => {
    const tasks = [task('t_old_low', 100, 0), task('t_new_high', 300, 2), task('t_old_high', 200, 2)]

    expect(sortColumnTasks(tasks, 'desc').map(t => t.id)).toEqual(['t_new_high', 't_old_high', 't_old_low'])
  })
})

describe('taskTimeLabel', () => {
  it('renders relative card times with the absolute datetime in the tooltip', () => {
    render(<>{taskTimeLabel({ created_at: 60, id: 't_demo', status: 'done', title: 'Demo' }, 'relative', 120_000)}</>)

    const label = screen.getByText('1 min. ago')

    expect(label).toBeTruthy()
    expect(label.getAttribute('title')).toBeTruthy()
    expect(label.getAttribute('title')).not.toBe('1 min. ago')
  })

  it('can render the card timestamp as a datetime', () => {
    render(<>{taskTimeLabel({ created_at: 60, id: 't_demo', status: 'done', title: 'Demo' }, 'datetime', 120_000)}</>)

    expect(screen.queryByText('1 min. ago')).toBeNull()
    expect(screen.getByTitle('1 min. ago')).toBeTruthy()
  })
})

// Compile-time exhaustiveness guard for the exported view state type.
const _sortDirections: TaskSortDirection[] = ['asc', 'desc']
void _sortDirections
