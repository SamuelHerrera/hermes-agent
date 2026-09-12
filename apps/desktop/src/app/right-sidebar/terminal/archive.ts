import { normalizeProfileKey } from '@/store/profile'

import { $terminalNavigation } from './navigation'
import { $terminals, closeTerminal, removeAgentTerminalByProc } from './terminals'

/** Resolve before optimistic session removal loses compression/runtime aliases. */
export function archivedTerminalIds(sessionIds: readonly string[], profile?: string | null): string[] {
  const ids = new Set(sessionIds)
  const navigation = $terminalNavigation.get()

  return $terminals.get().filter(terminal =>
    terminal.kind === 'agent' &&
    normalizeProfileKey(terminal.profile) === normalizeProfileKey(profile) &&
    (ids.has(terminal.ownerSessionId ?? '') || navigation.find(row => row.id === terminal.id)?.ownerAliases.some(id => ids.has(id)))
  ).map(terminal => terminal.id)
}

export function clearArchivedTerminals(sessionIds: readonly string[], profile?: string | null, processIds: readonly string[] = []): void {
  for (const id of archivedTerminalIds(sessionIds, profile)) {
    closeTerminal(id)
  }

  for (const id of processIds) {
    removeAgentTerminalByProc(id)
  }
}
