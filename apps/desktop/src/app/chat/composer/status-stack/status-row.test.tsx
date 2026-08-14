import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ComposerStatusItem } from '@/store/composer-status'

import { StatusItemRow } from './status-row'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      statusStack: {
        dismiss: 'Dismiss',
        exit: (code: number) => `exit ${code}`,
        running: 'Running',
        stop: 'Stop'
      }
    }
  })
}))

const item = (overrides: Partial<ComposerStatusItem> = {}): ComposerStatusItem => ({
  id: 'todo:long',
  state: 'done',
  title: 'Inspect all UAC Kanban card states, runs, comments, and dependency metadata before reporting',
  todoStatus: 'completed',
  type: 'todo',
  ...overrides
})

describe('StatusItemRow', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('lets the title fill the row before truncating and exposes the full title in a tooltip', async () => {
    render(<StatusItemRow item={item()} />)

    const title = screen.getByText(item().title)

    expect(title.classList.contains('flex-1')).toBe(true)
    expect(title.classList.contains('max-w-[18rem]')).toBe(false)
    expect(title.closest('[data-slot="tooltip-trigger"]')).toBe(title)

    fireEvent.pointerMove(title, { pointerType: 'mouse' })

    expect((await screen.findByRole('tooltip')).textContent).toContain(item().title)
  })

  it('keeps subagent tool metadata from stealing truncation space', () => {
    render(<StatusItemRow item={item({ currentTool: 'browser_use', type: 'subagent' })} onOpen={() => undefined} />)

    const title = screen.getByText(item().title)
    const tool = screen.getByText('Browser Use')

    expect(title.classList.contains('flex-1')).toBe(true)
    expect(tool.classList.contains('max-w-[8rem]')).toBe(true)
  })
})
