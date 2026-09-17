/**
 * Window translucency (see-through window).
 *
 * One lever, 0–100. 0 = off (fully opaque); the default is 10. Higher = more of the
 * desktop shows through the whole window — the main process maps it to the
 * native window opacity (`setOpacity`), the same effect as the Windows
 * shift-scroll trick. macOS + Windows only; Linux has no runtime window
 * opacity, so it's a no-op there.
 *
 * The renderer owns the value and mirrors it to the main process over IPC.
 */

import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

const KEY = 'hermes.desktop.translucency.v1'

// Keep the cold-start native window in electron/main.ts on the same default.
export const DEFAULT_TRANSLUCENCY = 10

const clamp = (n: number): number => Math.min(100, Math.max(0, Math.round(n)))

const read = (): number => {
  const raw = storedString(KEY)
  const n = raw === null ? DEFAULT_TRANSLUCENCY : Number(raw)

  return Number.isFinite(n) ? clamp(n) : DEFAULT_TRANSLUCENCY
}

export const $translucency = atom<number>(typeof window === 'undefined' ? DEFAULT_TRANSLUCENCY : read())

export function setTranslucency(intensity: number): void {
  $translucency.set(clamp(intensity))
}

if (typeof window !== 'undefined') {
  $translucency.subscribe(intensity => {
    persistString(KEY, String(intensity))
    window.hermesDesktop?.setTranslucency?.({ intensity })
  })
}
