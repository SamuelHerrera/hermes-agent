import { createBrowserTerminal } from './browser-terminal'
import { tryResolveHost } from './host'

type TerminalApi = NonNullable<NonNullable<Window['hermesDesktop']>['terminal']>

let cached: { host: object; api: TerminalApi } | null = null

export function terminalApi(): TerminalApi | undefined {
  const host = tryResolveHost()

  if (!host) {
    return undefined
  }

  if (host.kind === 'electron') {
    const native = window.hermesDesktop?.terminal

    if (!native) {
      return undefined
    }

    if (cached?.host !== host) {
      const shared = createBrowserTerminal(host)

      cached = {
        host,
        api: {
          ...native,
          list: shared.list,
          updateShared: shared.updateShared
        }
      }
    }

    return cached.api
  }

  if (!host.capabilities.persistentTerminal) {
    return undefined
  }

  if (cached?.host !== host) {
    cached = { host, api: createBrowserTerminal(host) }
  }

  return cached.api
}

export function resetTerminalApiForTests(): void {
  cached = null
}
