import { atom } from 'nanostores'

import { SIDEBAR_COLLAPSE_BREAKPOINT_PX } from '@/app/layout-constants'

import { $zoomPercent } from './zoom'

/** Layout width, not device type or the content width AFTER docking the rail.
 * Browser UI scale uses CSS zoom, which matchMedia does not account for.
 * Electron zoom already changes innerWidth; its document CSS zoom stays 1.
 */
function sidebarViewportIsNarrow(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const cssZoom = Number.parseFloat(document.documentElement.style.zoom) || 1

  return window.innerWidth / cssZoom <= SIDEBAR_COLLAPSE_BREAKPOINT_PX
}

export const $sidebarNarrowViewport = atom(sidebarViewportIsNarrow())

const refresh = () => $sidebarNarrowViewport.set(sidebarViewportIsNarrow())

if (typeof window !== 'undefined') {
  window.addEventListener('resize', refresh)
  $zoomPercent.listen(refresh)
}
