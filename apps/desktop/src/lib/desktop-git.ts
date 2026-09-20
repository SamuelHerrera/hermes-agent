import { createBrowserGit } from '@/platform/browser-git'
import { tryResolveHost } from '@/platform/host'

import { desktopFsProfile, isDesktopFsRemoteMode } from './desktop-fs'

type GitBridge = NonNullable<NonNullable<Window['hermesDesktop']>['git']>

/** Git always belongs to the selected backend host. Browser hosts never fall
 * back to a preload bridge that happens to exist on the browser machine. */
export function desktopGit(): GitBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const host = tryResolveHost()
  if (host?.kind === 'browser') {
    return host.capabilities.backendGit ? createBrowserGit(host, desktopFsProfile) : undefined
  }

  if (isDesktopFsRemoteMode()) {
    return host?.capabilities.backendGit ? createBrowserGit(host, desktopFsProfile) : undefined
  }

  return window.hermesDesktop?.git
}
