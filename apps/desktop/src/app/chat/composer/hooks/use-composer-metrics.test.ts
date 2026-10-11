import { describe, expect, it } from 'vitest'

import { COMPOSER_COMPACT_PILL_PX, COMPOSER_SINGLE_LINE_MAX_PX } from '../composer-utils'

import { nextComposerExpanded } from './use-composer-metrics'

describe('nextComposerExpanded', () => {
  it('collapses a previously wrapped composer once a wide Android/zoomed view fits on one line', () => {
    expect(
      nextComposerExpanded({
        composerWidth: COMPOSER_COMPACT_PILL_PX,
        editorScrollHeight: COMPOSER_SINGLE_LINE_MAX_PX,
        expanded: true,
        hasHardNewline: false,
        isEmpty: false
      })
    ).toBe(false)
  })

  it('keeps the stacked row when the composer is still narrow', () => {
    expect(
      nextComposerExpanded({
        composerWidth: COMPOSER_COMPACT_PILL_PX - 1,
        editorScrollHeight: COMPOSER_SINGLE_LINE_MAX_PX,
        expanded: true,
        hasHardNewline: false,
        isEmpty: false
      })
    ).toBe(true)
  })

  it('preserves explicit multi-line input even on wide composers', () => {
    expect(
      nextComposerExpanded({
        composerWidth: COMPOSER_COMPACT_PILL_PX + 200,
        editorScrollHeight: COMPOSER_SINGLE_LINE_MAX_PX,
        expanded: true,
        hasHardNewline: true,
        isEmpty: false
      })
    ).toBe(true)
  })
})
