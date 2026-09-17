/**
 * Per-preview browser tool state.
 *
 * The preview console has to outlive any one pane render and be addressable by
 * tab id: the console store is created lazily per tab and cached here. The
 * active `PreviewPane` contributes the visible browser tools menu to the app
 * toolbar so console / DevTools controls stay out of the native tab strip.
 */

import { createPreviewConsoleState, type PreviewConsoleState } from './preview-console-state'

const consoleStates = new Map<string, PreviewConsoleState>()

/** The console store for a tab, created on first use. Cached so the toolbar
 *  menu and the panel in the pane read the SAME store. */
export function previewConsoleState(tabId: string): PreviewConsoleState {
  const existing = consoleStates.get(tabId)

  if (existing) {
    return existing
  }

  const created = createPreviewConsoleState()
  consoleStates.set(tabId, created)

  return created
}

/** Drop a closed tab's state so a long-lived window doesn't pin every preview it
 *  ever opened. */
export function forgetPreviewStripTools(tabId: string) {
  consoleStates.delete(tabId)
}
