import { afterEach, describe, expect, it } from 'vitest'

import { allPaneIds, findGroupOfPane, group, split } from '@/components/pane-shell/tree/model'
import { $layoutTree } from '@/components/pane-shell/tree/store'

import { watchRetiredReviewPane } from './retired-review'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  $layoutTree.set(null)
})

describe('retired native review layouts', () => {
  it('migrates boot and later restored layouts while preserving runtime Git and file tabs', () => {
    $layoutTree.set(
      split(
        'row',
        [group(['workspace']), group(['review']), group(['git-ui:git', 'files'], { active: 'git-ui:git' })],
        [3, 1, 1]
      )
    )
    dispose = watchRetiredReviewPane()
    const migrated = $layoutTree.get()!
    expect(allPaneIds(migrated)).toEqual(['workspace', 'git-ui:git', 'files'])
    expect(findGroupOfPane(migrated, 'git-ui:git')?.active).toBe('git-ui:git')

    // A screen switch restores another old tree after initial boot.
    $layoutTree.set(group(['workspace', 'review', 'files'], { active: 'review' }))
    expect(allPaneIds($layoutTree.get()!)).toEqual(['workspace', 'files'])
    expect(findGroupOfPane($layoutTree.get()!, 'workspace')?.active).not.toBe('review')
  })

  it('leaves layouts without the retired pane untouched', () => {
    const tree = group(['workspace', 'git-ui:git'])
    $layoutTree.set(tree)
    dispose = watchRetiredReviewPane()
    expect($layoutTree.get()).toBe(tree)
    $layoutTree.set(null)
    expect($layoutTree.get()).toBeNull()
  })
})
