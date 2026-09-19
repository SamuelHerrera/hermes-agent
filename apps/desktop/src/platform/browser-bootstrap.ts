import type { BrowserBootstrapConfig } from './browser-api'
import { createBrowserHost } from './browser-host'
import { installHost } from './host'
import type { HermesHost } from './types'

interface BrowserBootstrapTarget {
  hermesDesktop?: unknown
  __HERMES_DESKTOP_BOOTSTRAP__?: unknown
}

interface BootstrapDependencies {
  createHost?: (config: BrowserBootstrapConfig) => Promise<HermesHost>
}

export function parseBrowserBootstrap(value: unknown): BrowserBootstrapConfig {
  if (!value || typeof value !== 'object') {throw new Error('Missing browser Desktop bootstrap.')}
  const source = value as Record<string, unknown>

  if (typeof source.authRequired !== 'boolean') {throw new Error('Invalid authRequired browser bootstrap value.')}

  if (typeof source.basePath !== 'string' || (source.basePath !== '' && !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(source.basePath))) {
    throw new Error('Invalid basePath browser bootstrap value.')
  }

  const sessionToken = source.sessionToken

  if (sessionToken !== undefined && sessionToken !== null && typeof sessionToken !== 'string') {
    throw new Error('Invalid sessionToken browser bootstrap value.')
  }

  if (!source.authRequired && typeof sessionToken !== 'string') {
    throw new Error('Loopback browser Desktop requires an injected sessionToken.')
  }

  return {
    authRequired: source.authRequired,
    basePath: source.basePath.replace(/\/+$/, ''),
    sessionToken: typeof sessionToken === 'string' ? sessionToken : null
  }
}

export async function bootstrapBrowserHost(
  target: BrowserBootstrapTarget = window,
  dependencies: BootstrapDependencies = {}
): Promise<boolean> {
  if (target.hermesDesktop) {return false}
  const config = parseBrowserBootstrap(target.__HERMES_DESKTOP_BOOTSTRAP__)
  const host = await (dependencies.createHost ?? createBrowserHost)(config)
  installHost(host)

  return true
}

// The browser build rewrites index.html to this entry. Await installation and
// capability discovery before importing main.tsx, whose first action resolves
// the host and then mounts React. Electron's ordinary entry remains unchanged.
if (import.meta.env.MODE === 'browser') {
  await bootstrapBrowserHost(window)
  await import('../main')
}
