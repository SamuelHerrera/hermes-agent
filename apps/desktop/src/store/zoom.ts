/**
 * Window text size (zoom).
 *
 * Electron's main process owns the zoom level and persists it (see electron/zoom.ts
 * for the scale). The renderer only mirrors the current percent for the
 * settings UI: preset clicks go to the main process over IPC, and every
 * change comes back through onChanged, including ones made with the
 * Ctrl/Cmd +/-/0 shortcuts or the View menu, so the UI never drifts.
 * Browser clients own document CSS zoom and an origin-local saved preference.
 */

import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'
import { tryResolveHost } from '@/platform/host'

const BROWSER_SCALE_KEY = 'hermes.browser.uiScale.v1'
const isBrowser = () => tryResolveHost()?.kind === 'browser'

const clampBrowserScale = (percent: number) =>
  Number.isFinite(percent) && percent > 0 ? Math.min(175, Math.max(75, Math.round(percent))) : 100

export function isUiScaleAvailable(): boolean {
  return isBrowser() || (typeof window !== 'undefined' && Boolean(window.hermesDesktop?.zoom))
}

// Mirror DEFAULT_ZOOM_LEVEL (90%) so Appearance doesn't flash 100% before
// the main-process zoom.get() resolves. Keep in sync with electron/zoom.ts.
export const $zoomPercent = atom<number>(90)

export function setZoomPercent(percent: number): void {
  if (isBrowser()) {
    const scale = clampBrowserScale(percent)
    // Scale the document, including portaled menus/dialogs, not only #root.
    document.documentElement.style.zoom = String(scale / 100)
    $zoomPercent.set(scale)
    persistString(BROWSER_SCALE_KEY, String(scale))

    return
  }

  window.hermesDesktop?.zoom?.setPercent(percent)
}

if (typeof window !== 'undefined' && isBrowser()) {
  const saved = storedString(BROWSER_SCALE_KEY)
  setZoomPercent(saved === null ? 100 : Number(saved))
} else if (typeof window !== 'undefined' && window.hermesDesktop?.zoom) {
  void window.hermesDesktop.zoom.get().then(({ percent }) => $zoomPercent.set(percent))
  window.hermesDesktop.zoom.onChanged(({ percent }) => $zoomPercent.set(percent))
}
