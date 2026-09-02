import { describe, expect, it } from 'vitest'

import { tokenizeInlineMarkdown } from './inline-markdown'

describe('tokenizeInlineMarkdown', () => {
  it('recognizes lightweight inline markdown styles', () => {
    expect(tokenizeInlineMarkdown('**bold** *em* ~~gone~~ `code`')).toMatchObject([
      { kind: 'strong', markerOpen: '**', text: 'bold' },
      { kind: 'text', text: ' ' },
      { kind: 'em', markerOpen: '*', text: 'em' },
      { kind: 'text', text: ' ' },
      { kind: 'strike', markerOpen: '~~', text: 'gone' },
      { kind: 'text', text: ' ' },
      { kind: 'code', markerOpen: '`', text: 'code' }
    ])
  })

  it('does not parse directive backticks as inline code', () => {
    expect(tokenizeInlineMarkdown('see @file:`apps/desktop/a b.ts` and `run`')).toMatchObject([
      { kind: 'text', text: 'see @file:`apps/desktop/a b.ts` and ' },
      { kind: 'code', text: 'run' }
    ])
  })

  it('does not parse underscores inside words', () => {
    expect(tokenizeInlineMarkdown('keep foo_bar_baz but parse _this_')).toMatchObject([
      { kind: 'text', text: 'keep foo_bar_baz but parse ' },
      { kind: 'em', text: 'this' }
    ])
  })
})
