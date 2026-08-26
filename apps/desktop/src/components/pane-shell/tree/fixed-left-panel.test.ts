import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

import { findGroupOfPane, group, split } from './model'
import { $layoutTree, declareDefaultTree, moveTreePane } from './store'

const disposers: (() => void)[] = []

function registerPane(id: string, placement: 'left' | 'main' | 'right') {
  disposers.push(
    registry.register({
      area: 'panes',
      data: { placement },
      id,
      render: () => null,
      title: id
    })
  )
}

beforeEach(() => {
  window.localStorage.clear()
  registerPane('sessions', 'left')
  registerPane('workspace', 'main')
  registerPane('files', 'right')
  registerPane('git', 'main')
})

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  $layoutTree.set(null)
})

describe('fixed left sessions panel', () => {
  it('evicts every non-session pane from a persisted sessions group', () => {
    declareDefaultTree(
      split('row', [
        group(['sessions', 'files', 'git'], { active: 'sessions', id: 'g-left' }),
        group(['workspace'], { active: 'workspace', id: 'g-main' })
      ])
    )

    expect(findGroupOfPane($layoutTree.get()!, 'sessions')?.panes).toEqual(['sessions'])
    expect(findGroupOfPane($layoutTree.get()!, 'files')?.panes).not.toContain('sessions')
    expect(findGroupOfPane($layoutTree.get()!, 'git')?.panes).not.toContain('sessions')
  })

  it('redirects tab drops away from the sessions group', () => {
    declareDefaultTree(
      split('row', [
        group(['sessions'], { active: 'sessions', id: 'g-left' }),
        group(['workspace'], { active: 'workspace', id: 'g-main' }),
        group(['files'], { active: 'files', id: 'g-files' })
      ])
    )

    moveTreePane('files', { groupId: 'g-left', pos: 'center' })

    expect(findGroupOfPane($layoutTree.get()!, 'sessions')?.panes).toEqual(['sessions'])
    expect(findGroupOfPane($layoutTree.get()!, 'files')?.panes).not.toContain('sessions')
  })
})
