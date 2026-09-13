import { describe, expect, it } from 'vitest'

import { foregroundProcessNameFromPs } from './terminal-process-title'

const ps = (rows: string[]) => rows.join('\n')

describe('foregroundProcessNameFromPs', () => {
  it('returns the owner shell when no foreground child is active', () => {
    expect(
      foregroundProcessNameFromPs(
        ps([
          '100 1 100 ttys001 Ss+ /bin/zsh',
          '200 1 200 ttys002 S+ /usr/bin/ssh'
        ]),
        100
      )
    ).toBe('zsh')
  })

  it('returns a local foreground TUI child instead of the shell', () => {
    expect(
      foregroundProcessNameFromPs(
        ps([
          '100 1 100 ttys001 Ss /bin/zsh',
          '210 100 210 ttys001 S+ /opt/homebrew/bin/btop'
        ]),
        100
      )
    ).toBe('btop')
  })

  it('returns ssh for a remote foreground session instead of guessing remote children', () => {
    expect(
      foregroundProcessNameFromPs(
        ps([
          '100 1 100 ttys001 Ss /bin/zsh',
          '220 100 220 ttys001 S+ /usr/bin/ssh'
        ]),
        100
      )
    ).toBe('ssh')
  })

  it('ignores unrelated foreground jobs on another tty', () => {
    expect(
      foregroundProcessNameFromPs(
        ps([
          '100 1 100 ttys001 Ss+ /bin/zsh',
          '300 1 300 ttys002 S+ /usr/local/bin/btop'
        ]),
        100
      )
    ).toBe('zsh')
  })
})
