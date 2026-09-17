export const CONTENT_INSTALLATION_VERSION = 'inspection-2'
type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | undefined
interface Installation { version: string, listener: Listener, dispose(): void }
interface MessageEvent {
  addListener(listener: Listener): void
  removeListener(listener: Listener): void
  hasListener(listener: Listener): boolean
}
const KEY = '__hermesContentInstallation'

// Stored in Chrome's isolated world, not the page's JavaScript world.
export function installContentListener(
  scope: object,
  event: MessageEvent,
  version: string,
  create: () => Omit<Installation, 'version'>
): void {
  const state = scope as Record<string, Installation | undefined>
  const old = state[KEY]

  if (old?.version === version) {
    try { if (event.hasListener(old.listener)) { return } } catch { /* invalid extension context */ }
  }

  if (old) {
    try { event.removeListener(old.listener) } catch { /* invalid extension context */ }

    try { old.dispose() } catch { /* best effort cleanup */ }
  }

  const installation = { ...create(), version }
  event.addListener(installation.listener)
  state[KEY] = installation
}
