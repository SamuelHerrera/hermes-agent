import { createDefaultTerminal } from '@/app/right-sidebar/terminal/actions'
import { $activeTerminalId, $terminals, selectTerminal } from '@/app/right-sidebar/terminal/terminals'
import { revealTreePane } from '@/components/pane-shell/tree/store'

import { setFileBrowserOpen, setSidebarOpen } from './layout'
import { openReview } from './review'

// Explicit-request pane reveals, keyed to the backend `focus_pane` tool. Each
// entry drives the pane's own reveal path (some are toggle-bound) so a revealed
// pane matches a user-driven open. files/review are workspace-gated — a no-op
// without a project cwd, which is the honest behavior.
const PANE_REVEALERS: Record<string, () => void> = {
  chat: () => revealTreePane('workspace'),
  files: () => setFileBrowserOpen(true),
  review: () => openReview(),
  sessions: () => setSidebarOpen(true),
  terminal: () => {
    const active = $activeTerminalId.get()
    const id = $terminals.get().find(terminal => terminal.id === active)?.id ?? $terminals.get()[0]?.id

    if (id) {
      selectTerminal(id)
    } else {
      createDefaultTerminal()
    }
  }
}

/** Reveal a desktop pane by name. Returns false for an unknown pane. */
export function revealDesktopPane(pane: string): boolean {
  const reveal = PANE_REVEALERS[pane]

  if (!reveal) {
    return false
  }

  reveal()

  return true
}
