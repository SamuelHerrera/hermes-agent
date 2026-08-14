import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Contribution } from '@/contrib/types'

import { contributedNavItems } from './nav-contributions'

afterEach(cleanup)

describe('contributed sidebar nav items', () => {
  it('preserves a contribution render callback as row adornment chrome', () => {
    const items = contributedNavItems([
      {
        area: 'sidebar.nav',
        data: { codicon: 'project', label: 'Kanban', path: '/kanban' },
        id: 'kanban:nav',
        render: () => <span data-testid="kanban-nav-adornment">3</span>,
        source: 'plugin:kanban'
      } satisfies Contribution
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'kanban:nav', label: 'Kanban', route: '/kanban' })
    expect(items[0].adornment).toBeTypeOf('function')

    const Adornment = items[0].adornment!
    render(<Adornment />)

    expect(screen.getByTestId('kanban-nav-adornment').textContent).toBe('3')
  })

  it('drops malformed contributions', () => {
    expect(
      contributedNavItems([
        { area: 'sidebar.nav', data: { label: 'No path' }, id: 'bad' },
        { area: 'sidebar.nav', data: { label: 'Relative', path: 'kanban' }, id: 'relative' }
      ])
    ).toEqual([])
  })
})