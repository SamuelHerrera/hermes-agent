/**
 * PREVIEW TILES — every open preview (a file, a URL, an artifact) rendered as a
 * layout-tree pane, the preview analog of session and route tiles.
 *
 * The rail used to bring its OWN tab strip: a second bar beside the zone's own,
 * at a different height, with its own close menu and its own label casing. It
 * predated the layout tree. Now `$previewTabs` mirrors into pane contributions
 * through the same `paneMirror` the other tiles use, so a preview tab IS a zone
 * tab — same strip, same drag/stack/split, same ⌘W, same right-click verbs, and
 * one bar instead of two.
 */

import { useStore } from '@nanostores/react'

import { findGroup } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree, revealTreePane } from '@/components/pane-shell/tree/store'
import { FileTypeIcon } from '@/components/ui/file-type-icon'
import { ToolIcon } from '@/components/ui/tool-icon'
import { $rightRailActiveTabId, type RightRailTabId, selectRightRailTab } from '@/store/layout'
import {
  $previewRevealRequest,
  $previewTabs,
  closeRightRailTab,
  type PreviewTab,
  type PreviewTarget
} from '@/store/preview'

import { paneMirror } from './pane-mirror'
import { PreviewTilePane } from './right-rail/preview'
import { forgetPreviewStripTools } from './right-rail/preview-strip-tools'

/** The target behind a tile id, or null once its tab is gone. */
function targetFor(tabId: string): PreviewTarget | null {
  return $previewTabs.get().find(tab => tab.id === tabId)?.target ?? null
}

/** User-visible tab title. A file names the file; an artifact is titled rather
 * than located; a browser tab follows the loaded page title/URL. */
function previewTabTitle(tabId: string): string {
  const target = targetFor(tabId)

  if (!target) {
    return 'Preview'
  }

  if (target.kind === 'url') {
    return target.label && target.label !== 'about:blank' ? target.label : 'Browser'
  }

  if (target.kind === 'artifact') {
    return target.label || 'Preview'
  }

  const value = target.label || target.path || target.source || target.url
  const tail = value.split(/[\\/]/).filter(Boolean).at(-1)

  return tail || value || 'Preview'
}

/** Registered pane title. Browser tabs keep this stable while the live tab
 * label above changes through `tabTitle`, otherwise every page title update
 * replaces the pane contribution and can remount the guest webview. */
function previewPaneTitle(tabId: string): string {
  const target = targetFor(tabId)

  return target?.kind === 'url' && target.browserTabKey ? 'Browser' : previewTabTitle(tabId)
}

/** The tab's lead glyph — the same file/tool icon family the file tree and code
 *  fences resolve through, so a `.tsx` peek and its sidebar row agree. */
function PreviewTabLead({ tabId }: { tabId: string }) {
  const target = targetFor(tabId)

  if (!target) {
    return null
  }

  if (target.kind === 'artifact') {
    return <ToolIcon className="opacity-70" name="sparkle" size="0.6875rem" />
  }

  if (target.kind === 'url') {
    return <ToolIcon className="opacity-70" name="globe" size="0.6875rem" />
  }

  return <FileTypeIcon className="opacity-70" path={target.path || target.url} size="0.6875rem" />
}

/** Live tab label for preview tabs. Browser tabs can navigate and retitle many
 * times inside one guest webview. The label must update without changing the
 * pane contribution's registered `title`, because replacing that contribution
 * can remount the guest webview and restart auth redirects. */
function PreviewTabTitle({ tabId }: { tabId: string }) {
  useStore($previewTabs)

  return previewTabTitle(tabId)
}

const PREVIEW_TILE_PREFIX = 'preview-tile'

/** Keep pane contributions mirroring `$previewTabs`, keep the store's selection
 *  and the tree's active pane agreeing, and front a tile when its tab is
 *  selected. Call once from the root. */
export function watchPreviewTiles(): void {
  watchPreviewTileMirror()

  // The reveal analog of session tiles (session-states calls revealTreePane on
  // open): `openPreview` selects the tab, and the TREE must front its pane —
  // un-minimize, un-hide, activate in its zone. Selection changes cover normal
  // tab switches; `$previewRevealRequest` covers explicitly re-opening the
  // already-active tab. Do NOT reveal on every `$previewTabs` mutation: browser
  // tabs persist live page titles there, and YouTube Music retitles on every
  // song change while it may be sitting in the background.
  const reveal = () => {
    const tabId = $rightRailActiveTabId.get()

    if (tabId && targetFor(tabId)) {
      revealTreePane(`${PREVIEW_TILE_PREFIX}:${tabId}`)
    }
  }

  $rightRailActiveTabId.listen(reveal)
  $previewRevealRequest.listen(reveal)

  // And the reverse: clicking a preview TAB activates its pane in the TREE
  // only, so the store's selection must follow or `$previewTarget` (⌘L quote
  // labels, the titlebar's has-preview state) keeps reporting the previous
  // tab. Same derivation `$focusedStoredSessionId` uses: the interacted zone's
  // active pane names the tab. Converges with `reveal` — re-selecting the id
  // the tree already fronts is a no-op in both directions.
  const follow = () => {
    const tree = $layoutTree.get()
    const groupId = $activeTreeGroup.get()
    const active = groupId && tree ? findGroup(tree, groupId)?.active : undefined

    if (!active?.startsWith(`${PREVIEW_TILE_PREFIX}:`)) {
      return
    }

    const tabId = active.slice(PREVIEW_TILE_PREFIX.length + 1) as RightRailTabId

    if (targetFor(tabId) && $rightRailActiveTabId.get() !== tabId) {
      selectRightRailTab(tabId)
    }
  }

  $layoutTree.listen(follow)
  $activeTreeGroup.listen(follow)
}

const watchPreviewTileMirror = paneMirror<PreviewTab>({
  source: $previewTabs,
  key: tab => tab.id,
  prefix: PREVIEW_TILE_PREFIX,
  // Normal opens are tabs in their caller's panel, not automatic splits.
  dir: () => 'center',
  anchor: tab => tab.anchor,
  minWidth: '22rem',
  title: previewPaneTitle,
  tabLead: tabId => <PreviewTabLead tabId={tabId} />,
  tabTitle: tabId => <PreviewTabTitle tabId={tabId} />,
  render: tabId => <PreviewTilePane tabId={tabId} />,
  close: tabId => {
    forgetPreviewStripTools(tabId)
    closeRightRailTab(tabId)
  }
})
