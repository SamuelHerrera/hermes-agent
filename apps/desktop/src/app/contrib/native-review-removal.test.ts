import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { KEYBIND_ACTIONS } from '@/lib/keybinds/actions'

// Architectural boundary: Git review belongs to runtime plugins, not core UI.
// Git IPC, decorations, and branch/worktree infrastructure remain shared.
const source = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')

describe('native Git review removal', () => {
  it('does not register a native review keyboard action', () => {
    expect(KEYBIND_ACTIONS.some(action => action.id === 'view.toggleReview')).toBe(false)
  })

  it('has no core review registration, opener, status option, or component', () => {
    for (const path of [
      'app/contrib/controller.tsx',
      'app/contrib/panes.tsx',
      'app/hooks/use-keybinds.ts',
      'app/shell/hooks/use-statusbar-items.tsx',
      'app/chat/composer/index.tsx',
      'components/assistant-ui/thread/changed-files-card.tsx'
    ]) {
      expect(source(path), path).not.toMatch(/store\/review|right-sidebar\/review|view\.toggleReview|ReviewPaneContent/)
    }

    expect(source('app/contrib/controller.tsx')).not.toMatch(/id: 'review'|group\(\['review'\]/)
    expect(existsSync(resolve(import.meta.dirname, '../../store/review.ts'))).toBe(false)
    expect(existsSync(resolve(import.meta.dirname, '../right-sidebar/review'))).toBe(false)
  })
})
