import type { ReactNode } from 'react'

import type { PreviewTarget } from '@/store/preview'

/**
 * Plugin-provided renderers for native file preview tabs.
 *
 * The right rail keeps owning tab identity, file watching, reload, and chrome;
 * plugins only decide whether they can render a file target and return the body
 * for that tab. This lets file-tree opens stay native instead of routing through
 * a disconnected plugin page.
 */
export const PREVIEW_RENDERERS_AREA = 'preview.renderers'

export interface PreviewRendererRenderProps {
  /** Bumped when the user reloads the preview or the watched file changes. */
  reloadKey: number
  target: PreviewTarget
}

export interface PreviewRendererContribution {
  /** Human label for diagnostics/settings surfaces. */
  label?: string
  /** Return true when this renderer owns the target. Keep this pure and cheap. */
  matches: (target: PreviewTarget) => boolean
  /** Render the tab body. The host wraps this in a contribution boundary. */
  render: (props: PreviewRendererRenderProps) => ReactNode
}

export function isPreviewRendererContribution(value: unknown): value is PreviewRendererContribution {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<PreviewRendererContribution>

  return typeof candidate.matches === 'function' && typeof candidate.render === 'function'
}
