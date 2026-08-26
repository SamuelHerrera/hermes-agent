import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'

import { VirtualSessionList } from './virtual-session-list'

const renderedRows: Array<Record<string, unknown>> = []

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ end: (index + 1) * 28, index, start: index * 28 })),
    measureElement: vi.fn()
  })
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        dateDivider: {}
      }
    }
  })
}))

vi.mock('./session-row', () => ({
  SidebarSessionRow: (props: Record<string, unknown> & { onToggleBranch?: () => void; session: SessionInfo }) => {
    renderedRows.push(props)

    return (
      <button data-testid={`virtual-row-${props.session.id}`} onClick={props.onToggleBranch} type="button">
        {props.session.id}
      </button>
    )
  }
}))

afterEach(() => {
  cleanup()
  renderedRows.length = 0
})

const noop = vi.fn()

function session(id: string): SessionInfo {
  return { id, profile: 'default', started_at: 1 } as unknown as SessionInfo
}

describe('VirtualSessionList branch controls', () => {
  it('threads child count, disclosure state, and the collapse callback to virtualized rows', async () => {
    const onToggleBranch = vi.fn()

    render(
      <VirtualSessionList
        activeSessionId={null}
        onArchiveSession={noop}
        onDeleteSession={noop}
        onResumeSession={noop}
        onToggleBranch={onToggleBranch}
        onTogglePin={noop}
        pinned={false}
        rows={[
          {
            entry: {
              branchChildCount: 2,
              branchCollapsed: true,
              hasBranchChildren: true,
              session: session('parent')
            },
            kind: 'session'
          }
        ]}
        sortable={false}
      />
    )

    await waitFor(() => expect(screen.getByTestId('virtual-row-parent')).toBeTruthy())

    const props = renderedRows.at(-1)

    expect(props).toMatchObject({ branchChildCount: 2, branchCollapsed: true, hasBranchChildren: true })
    fireEvent.click(screen.getByTestId('virtual-row-parent'))
    expect(onToggleBranch).toHaveBeenCalledWith('parent')
  })
})
