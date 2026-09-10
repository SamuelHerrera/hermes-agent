import { computed } from 'nanostores'

import { findGroup, findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree, isMainStripPane } from '@/components/pane-shell/tree/store'
import { $sessions, lineageAliases } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { $terminals, type TerminalEntry } from './terminals'

let lastContentGroup: string | undefined
export const $focusedTerminalId = computed([$layoutTree, $activeTreeGroup], (tree, groupId) => {
  if (!tree) {
    lastContentGroup = undefined

    return null
  }

  const focused = groupId ? findGroup(tree, groupId) : null

  // Sidebar/tool chrome has its own zone: clicking it must not deselect the
  // active content tab, or select every visible terminal in a split layout.
  if (focused && (isMainStripPane(focused.active) || focused.active === 'workspace' ||
    focused.active.startsWith('session-tile:') || focused.active.startsWith('terminal-instance:'))) {
    lastContentGroup = focused.id
  }

  const pane = (lastContentGroup ? findGroup(tree, lastContentGroup) : null)?.active ??
    findGroupOfPane(tree, 'workspace')?.active

  return pane?.startsWith('terminal-instance:') ? pane.slice('terminal-instance:'.length) : null
})

export interface TerminalNavigationEntry extends Omit<TerminalEntry, 'restoreCwd' | 'reviveBuffer'> {
  ownerAliases: readonly string[]
}

// Scrollback and chat streaming must not repaint every project/sidebar row.
// Resolve runtime ownership here so late session hydration/compression is also
// reflected without waiting for another process-list poll.
let previous: TerminalNavigationEntry[] = []
export const $terminalNavigation = computed([$terminals, $sessionStates, $sessions], (terminals, states, sessions) => {
  const next = terminals.map(terminal => {
    const owner = terminal.ownerSessionId
      ? (states[terminal.ownerSessionId]?.storedSessionId ?? terminal.ownerSessionId)
      : undefined

    const aliases = owner ? lineageAliases(owner, sessions) : []
    const session = sessions.find(session => aliases.includes(session.id))

    const row: TerminalNavigationEntry = {
      id: terminal.id,
      title: terminal.title,
      auto: terminal.auto,
      kind: terminal.kind,
      cwd: terminal.cwd,
      procId: terminal.procId,
      projectId: terminal.projectId,
      profile: session?.profile ?? terminal.profile,
      ownerSessionId: owner,
      hidden: terminal.hidden,
      ownerAliases: aliases
    }

    const old = previous.find(item => item.id === row.id)

    return old &&
      Object.keys(row).every(key =>
        key === 'ownerAliases'
          ? old.ownerAliases.join('\0') === aliases.join('\0')
          : old[key as keyof TerminalNavigationEntry] === row[key as keyof TerminalNavigationEntry]
      )
      ? old
      : row
  })

  if (next.length === previous.length && next.every((row, index) => row === previous[index])) {
    return previous
  }

  previous = next

  return next
})
