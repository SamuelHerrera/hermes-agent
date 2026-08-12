import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  createNewTaskDraft,
  minimizedNewTaskDrafts,
  NEW_TASK_MINIMIZE_BUTTON_CLASS,
  NEW_TASK_MINIMIZE_BUTTON_SIZE,
  sortColumnTasks,
  type TaskSortDirection,
  taskSortDirectionForColumn,
  taskTimeLabel,
  toggleColumnSortDirection,
  updateNewTaskDraft
} from './board'
import type { KanbanTask } from './types'

const task = (id: string, created_at: number, priority = 0): KanbanTask => ({
  created_at,
  id,
  priority,
  status: 'done',
  title: id
})

describe('kanban board time sorting', () => {
  it('sorts each column oldest-first by task creation time regardless of priority', () => {
    const tasks = [task('t_new_high', 300, 2), task('t_old_low', 100, 0), task('t_mid_high', 200, 10)]

    expect(sortColumnTasks(tasks, 'asc').map(t => t.id)).toEqual(['t_old_low', 't_mid_high', 't_new_high'])
  })

  it('can reverse each column newest-first by task creation time regardless of priority', () => {
    const tasks = [task('t_old_high', 100, 10), task('t_new_low', 300, 0), task('t_mid_high', 200, 2)]

    expect(sortColumnTasks(tasks, 'desc').map(t => t.id)).toEqual(['t_new_low', 't_mid_high', 't_old_high'])
  })

  it('keeps sort direction independent per column', () => {
    const directions: Partial<Record<string, TaskSortDirection>> = { done: 'desc' }

    expect(taskSortDirectionForColumn(directions, 'done')).toBe('desc')
    expect(taskSortDirectionForColumn(directions, 'ready')).toBe('asc')
    expect(toggleColumnSortDirection(directions, 'done')).toEqual({ done: 'asc' })
    expect(toggleColumnSortDirection(directions, 'ready')).toEqual({ done: 'desc', ready: 'desc' })
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

describe('minimized new task drafts', () => {
  it('keeps the dialog minimize action icon-only and clear of the close button', () => {
    expect(NEW_TASK_MINIMIZE_BUTTON_SIZE).toBe('icon-xs')
    expect(NEW_TASK_MINIMIZE_BUTTON_CLASS).toContain('mr-8')
  })

  it('keeps multiple independent new task drafts available for restore', () => {
    const first = updateNewTaskDraft(createNewTaskDraft('triage'), { bodyText: 'first body', title: 'First screenshot task' })
    const second = updateNewTaskDraft(createNewTaskDraft('ready'), { priority: '3', title: 'Second screenshot task' })

    expect(minimizedNewTaskDrafts([first, second]).map(draft => [draft.target, draft.title])).toEqual([
      ['triage', 'First screenshot task'],
      ['ready', 'Second screenshot task']
    ])
  })

  it('does not mutate the existing draft while typing into a restored draft', () => {
    const draft = createNewTaskDraft('triage')
    const edited = updateNewTaskDraft(draft, { title: 'Collect screenshots' })

    expect(draft.title).toBe('')
    expect(edited.title).toBe('Collect screenshots')
    expect(edited.id).toBe(draft.id)
  })
})

// Compile-time exhaustiveness guard for the exported view state type.
const _sortDirections: TaskSortDirection[] = ['asc', 'desc']
void _sortDirections
