/**
 * Keep-awake — stop the machine sleeping during long, unattended runs.
 *
 * A selected-profile preference, off by default. The backend that owns the
 * active profile is authoritative, so Desktop and browser/PWA clients pointed at
 * the same profile show and mutate the same state. Older clients/backends fall
 * back to the local Electron bridge or browser Screen Wake Lock.
 */

import { atom } from 'nanostores'

import { getApiRequestProfile } from '@/hermes'
import { persistBoolean, storedBoolean } from '@/lib/storage'
import { browserClientApis } from '@/platform/browser-client'
import { tryResolveHost } from '@/platform/host'
import { hostApi } from '@/platform/host-api'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'

const KEY = 'hermes.desktop.keepAwake.v1'
let intentGeneration = 0

export const $keepAwake = atom<boolean>(typeof window === 'undefined' ? false : storedBoolean(KEY, false))
export const $keepAwakeBusy = atom(false)

interface KeepAwakeResult {
  ok: boolean
  on: boolean
  desired?: boolean
  error?: string
}

function commitKeepAwake(on: boolean) {
  $keepAwake.set(on)
  persistBoolean(KEY, on)
}

async function mirrorLocalElectronKeepAwake(on: boolean): Promise<void> {
  const bridge = window.hermesDesktop
  if (!bridge?.setKeepAwake || !bridge.getConnection) {
    return
  }

  try {
    const connection = await bridge.getConnection(getApiRequestProfile())

    if (connection.mode === 'local') {
      await bridge.setKeepAwake(on)
    }
  } catch {
    // Backend keep-awake is authoritative. The Electron blocker is a local-only
    // compatibility mirror and must not roll back the shared profile state.
  }
}

export async function refreshKeepAwake(): Promise<void> {
  const generation = intentGeneration

  try {
    const result = await hostApi<KeepAwakeResult>({ path: '/api/keep-awake', profile: getApiRequestProfile() })

    if (result.ok && generation === intentGeneration) {
      commitKeepAwake(result.on)
      void mirrorLocalElectronKeepAwake(result.on)
    }
    return
  } catch {
    // Preserve the last confirmed state when the backend route is unavailable.
  }

  const read = window.hermesDesktop?.getKeepAwake
  if (!read) {
    return
  }

  try {
    const result = await read()

    if (result.ok && generation === intentGeneration) {
      commitKeepAwake(result.on)
    }
  } catch {
    // Preserve the last confirmed state when the fallback bridge is unavailable.
  }
}

async function setBackendKeepAwake(on: boolean): Promise<KeepAwakeResult> {
  return hostApi<KeepAwakeResult>({
    body: { on },
    method: 'POST',
    path: '/api/keep-awake',
    profile: getApiRequestProfile()
  })
}

export async function setKeepAwake(on: boolean): Promise<void> {
  intentGeneration += 1

  const previous = $keepAwake.get()
  commitKeepAwake(on)

  const host = tryResolveHost()

  if (host?.capabilities.keepAwake) {
    $keepAwakeBusy.set(true)
    try {
      const result = await setBackendKeepAwake(on)

      if (!result.ok) {
        commitKeepAwake(result.on)
        notifyError(new Error(result.error || 'The system did not change keep-awake mode'), 'Could not change keep-awake mode')

        return
      }

      commitKeepAwake(result.on)
      void mirrorLocalElectronKeepAwake(result.on)
      return
    } catch (error) {
      // Older backends do not expose /api/keep-awake; fall through to the local
      // compatibility paths below so the button still works on one client.
      commitKeepAwake(previous)
    } finally {
      $keepAwakeBusy.set(false)
    }
  }

  const apply = window.hermesDesktop?.setKeepAwake

  if (!apply) {
    if (!host) {
      return
    }
    if (!host.capabilities.screenWakeLock) {
      commitKeepAwake(previous)
      return
    }
    $keepAwakeBusy.set(true)
    try {
      await browserClientApis().wakeLock.set(on)
    } catch (error) {
      commitKeepAwake(previous)
      notifyError(error, 'Could not change keep-awake mode')
    } finally {
      $keepAwakeBusy.set(false)
    }
    return
  }

  $keepAwakeBusy.set(true)

  try {
    const result = await apply(on)

    if (!result.ok) {
      commitKeepAwake(result.on)
      notifyError(new Error(result.error || 'The system did not change keep-awake mode'), 'Could not change keep-awake mode')

      return
    }

    commitKeepAwake(result.on)
  } catch (error) {
    commitKeepAwake(previous)
    notifyError(error, 'Could not change keep-awake mode')
  } finally {
    $keepAwakeBusy.set(false)
  }
}

if (typeof window !== 'undefined') {
  void refreshKeepAwake()
  $activeGatewayProfile.listen(() => void refreshKeepAwake())
}
