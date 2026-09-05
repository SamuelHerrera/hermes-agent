/**
 * Keep-awake — stop the machine sleeping during long, unattended runs.
 *
 * A device-local preference (each computer keeps its own), off by default. This
 * atom backs the Settings → Advanced toggle and mirrors changes to the main
 * process, which owns both the Electron idle-sleep blocker and the privileged
 * macOS closed-lid guard, plus its own persisted copy. Native results are
 * authoritative so cancelled authorization rolls the optimistic UI back.
 */

import { atom } from 'nanostores'

import { persistBoolean, storedBoolean } from '@/lib/storage'
import { notifyError } from '@/store/notifications'

const KEY = 'hermes.desktop.keepAwake.v1'
let intentGeneration = 0

export const $keepAwake = atom<boolean>(typeof window === 'undefined' ? false : storedBoolean(KEY, false))
export const $keepAwakeBusy = atom(false)

function commitKeepAwake(on: boolean) {
  $keepAwake.set(on)
  persistBoolean(KEY, on)
}

export async function refreshKeepAwake(): Promise<void> {
  const read = window.hermesDesktop?.getKeepAwake
  const generation = intentGeneration

  if (!read) {
    return
  }

  try {
    const result = await read()

    if (result.ok && generation === intentGeneration) {
      commitKeepAwake(result.on)
    }
  } catch {
    // Preserve the last confirmed state when the native bridge is unavailable.
  }
}

export async function setKeepAwake(on: boolean): Promise<void> {
  intentGeneration += 1

  const previous = $keepAwake.get()
  const apply = window.hermesDesktop?.setKeepAwake

  commitKeepAwake(on)

  if (!apply) {
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

if (typeof window !== 'undefined' && window.hermesDesktop?.getKeepAwake) {
  void refreshKeepAwake()
}
