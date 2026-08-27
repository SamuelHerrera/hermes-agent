/**
 * SESSION TILES — a stored session rendered as a layout-tree pane BESIDE the
 * main thread (multi-session tiling). A tile IS the real chat surface: the
 * same ChatView/ChatBar/Thread tree the primary session renders, mounted
 * under a tile `SessionView` (its session's slice of `$sessionStates`) and a
 * tile `ComposerScope` (own attachment chips, own focus-bus key). Actions
 * (submit/slash/steer/edit/reload/restore/stop) come from
 * `useSessionTileActions`, all writing through the wiring cache.
 *
 * Lifecycle: `openSessionTile(storedId)` -> `watchSessionTiles` registers a
 * pane contribution docked right of the main zone -> tree adoption lands it
 * -> the pane mounts and asks the delegate for a live runtime id. Closing
 * the pane (tab Close) removes the tile + its zone; tiles persist across
 * restarts and re-resume on boot.
 */

import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { atom, computed } from 'nanostores'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { useModelControls } from '@/app/session/hooks/use-model-controls'
import { blobToDataUrl } from '@/app/session/hooks/use-prompt-actions/utils'
import { resolveStoredSession } from '@/app/session/hooks/use-session-actions/utils'
import { ModelMenuPanel } from '@/app/shell/model-menu-panel'
import { formatRefValue } from '@/components/assistant-ui/directive-text'
import { CenteredThreadSpinner } from '@/components/assistant-ui/thread/status'
import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $layoutTree, closeTreePane, moveTreePane } from '@/components/pane-shell/tree/store'
import { Button } from '@/components/ui/button'
import { transcribeAudio } from '@/hermes'
import type { ChatMessage } from '@/lib/chat-messages'
import { NEW_SESSION_TITLE, sessionTitle } from '@/lib/chat-runtime'
import { $draftTitles, createComposerAttachmentScope, draftTitleFor, draftTitleIn } from '@/store/composer'
import { $pinnedSessionIds, pinSession, unpinSession } from '@/store/layout'
import { $activeGatewayProfile } from '@/store/profile'
import { $projectTree } from '@/store/projects'
import { sessionAwaitingInput } from '@/store/prompts'
import {
  $gatewayState,
  $rememberedSessionRestorePending,
  $selectedStoredSessionId,
  $sessions,
  getRememberedSessionTitle,
  sessionMatchesStoredId,
  sessionPinId,
  setRememberedSessionTitle
} from '@/store/session'
import {
  $sessionStates,
  $sessionTiles,
  closeSessionTile,
  discardSessionTile,
  patchSessionTile,
  promoteSessionTile,
  type SessionTile,
  sessionTileDelegate
} from '@/store/session-states'
import type { SessionInfo } from '@/types/hermes'

import type { SessionDragPayload } from './composer/inline-refs'
import { type ComposerScope, ComposerScopeProvider } from './composer/scope'
import { useComposerActions } from './hooks/use-composer-actions'
import { paneMirror } from './pane-mirror'
import { SessionDraftTitle } from './session-draft-title'
import { startSessionDrag } from './session-drag'
import { useSessionTileActions } from './session-tile-actions'
import { type SessionView, SessionViewProvider } from './session-view'
import { SessionContextMenu } from './sidebar/session-actions-menu'
import { SessionTabAttentionDot, SessionTabLead } from './subagent-session-icon'
import { lastVisibleMessageIsUser } from './thread-loading'

import { ChatView } from '.'

const NO_MESSAGES: ChatMessage[] = []
const NO_USAGE = { calls: 0, input: 0, output: 0, total: 0 } as const
const RESTORING_SESSION_TITLE = 'Restoring session'

/** The tile's SessionView: the same atom shape the primary chat renders
 *  from, computed from this session's slice of `$sessionStates`. */
function buildTileView(storedSessionId: string): SessionView {
  const $runtimeId = computed(
    $sessionTiles,
    tiles => tiles.find(t => t.storedSessionId === storedSessionId)?.runtimeId ?? null
  )

  const $state = computed([$runtimeId, $sessionStates], (runtimeId, states) =>
    runtimeId ? states[runtimeId] : undefined
  )

  const $messages = computed($state, state => state?.messages ?? NO_MESSAGES)
  const $usage = computed($state, state => state?.usage ?? NO_USAGE)

  return {
    kind: 'tile',
    $awaitingResponse: computed($state, state => Boolean(state?.awaitingResponse)),
    $busy: computed($state, state => Boolean(state?.busy)),
    $cwd: computed($state, state => state?.cwd ?? ''),
    $fast: computed($state, state => Boolean(state?.fast)),
    $lastVisibleIsUser: computed($messages, lastVisibleMessageIsUser),
    $messages,
    $messagesEmpty: computed($messages, messages => messages.length === 0),
    $model: computed($state, state => state?.model ?? ''),
    $provider: computed($state, state => state?.provider ?? ''),
    $reasoningEffort: computed($state, state => state?.reasoningEffort ?? ''),
    $runtimeId,
    // Constant for the tile's lifetime — a plain atom, not a computed.
    $storedId: atom(storedSessionId),
    $usage
  }
}

// Module-level constants so these ChatView props are referentially stable —
// tiles have no pin/delete affordance, and transcription needs no per-tile state.
const noop = () => undefined

const tileTranscribeAudio = async (audio: Blob) =>
  (await transcribeAudio(await blobToDataUrl(audio), audio.type)).transcript

function TileChat({
  runtimeId,
  storedSessionId,
  view
}: {
  runtimeId: string
  storedSessionId: string
  view: SessionView
}) {
  const { gateway, requestGateway } = useGatewayRequest()
  const queryClient = useQueryClient()
  const { selectModel } = useModelControls({ queryClient, requestGateway })
  const activeGatewayProfile = useStore($activeGatewayProfile)
  const cwd = useStore(view.$cwd)
  const gatewayOpen = useStore($gatewayState) === 'open'

  // One attachment set + focus key per tile, stable for the tile's lifetime.
  const attachments = useRef(createComposerAttachmentScope()).current

  const scope = useMemo<ComposerScope>(
    () => ({
      $awaitingInput: sessionAwaitingInput(runtimeId),
      $messages: view.$messages,
      attachments,
      target: `tile:${storedSessionId}`
    }),
    [attachments, runtimeId, storedSessionId, view.$messages]
  )

  const actions = useSessionTileActions({ runtimeId, scope, storedSessionId })
  const draftTitles = useStore($draftTitles)
  const draftTitle = draftTitleIn(draftTitles, scope.target) || draftTitleIn(draftTitles, storedSessionId)

  useEffect(() => {
    if (draftTitle) {
      promoteSessionTile(storedSessionId)
    }
  }, [draftTitle, storedSessionId])

  // The same attach/pick/paste/drop pipeline the primary composer uses,
  // pointed at this tile's chips + session.
  const composer = useComposerActions({
    activeSessionId: runtimeId,
    currentCwd: cwd,
    requestGateway,
    scope: { add: attachments.add, remove: attachments.remove, target: scope.target, update: attachments.update }
  })

  // ChatView is memo()d — every callback prop must be referentially stable or
  // the memo never holds and each tile-level render (idle ticks, unrelated
  // store updates) re-renders the whole chat shell. The individual composer
  // functions are useCallback'd inside useComposerActions, so hoisting these
  // wrappers onto them keeps identity stable across renders.
  const { addContextRefAttachment, pasteClipboardImage, pickContextPaths, pickImages, removeAttachment } = composer

  const onAddUrl = useCallback(
    (url: string) => addContextRefAttachment(`@url:${formatRefValue(url)}`, url),
    [addContextRefAttachment]
  )

  const onPasteClipboardImage = useCallback(
    (opts?: { silent?: boolean }) => pasteClipboardImage(opts),
    [pasteClipboardImage]
  )

  const onPickFiles = useCallback(() => void pickContextPaths('file'), [pickContextPaths])
  const onPickFolders = useCallback(() => void pickContextPaths('folder'), [pickContextPaths])
  const onPickImages = useCallback(() => void pickImages(), [pickImages])
  const onRemoveAttachment = useCallback((id: string) => void removeAttachment(id), [removeAttachment])
  const onRetryResume = useCallback(() => patchSessionTile(storedSessionId, { error: undefined }), [storedSessionId])

  // Per-tile model menu — rendered under this tile's SessionView so the pill
  // + switch target THIS runtime, not the primary (which may be mid-turn).
  const modelMenuContent = useMemo(
    () =>
      gatewayOpen ? (
        <ModelMenuPanel
          gateway={gateway || undefined}
          onSelectModel={selectModel}
          profile={activeGatewayProfile}
          requestGateway={requestGateway}
        />
      ) : null,
    [activeGatewayProfile, gateway, gatewayOpen, requestGateway, selectModel]
  )

  return (
    <SessionViewProvider value={view}>
      <ComposerScopeProvider value={scope}>
        <ChatView
          gateway={gateway}
          modelMenuContent={modelMenuContent}
          onAddContextRef={addContextRefAttachment}
          onAddUrl={onAddUrl}
          onAttachDroppedItems={composer.attachDroppedItems}
          onAttachImageBlob={composer.attachImageBlob}
          onAttachPrCommentUrl={composer.attachPrCommentUrl}
          onCancel={actions.cancelRun}
          onDeleteSelectedSession={noop}
          onDismissError={actions.dismissError}
          onEdit={actions.editMessage}
          onPasteClipboardImage={onPasteClipboardImage}
          onPickFiles={onPickFiles}
          onPickFolders={onPickFolders}
          onPickImages={onPickImages}
          onReload={actions.reloadFromMessage}
          onRemoveAttachment={onRemoveAttachment}
          onRestoreToMessage={actions.restoreToMessage}
          onRetryResume={onRetryResume}
          onSteer={actions.steerPrompt}
          onSubmit={actions.submitText}
          onThreadMessagesChange={actions.handleThreadMessagesChange}
          onToggleSelectedPin={noop}
          onTranscribeAudio={tileTranscribeAudio}
        />
      </ComposerScopeProvider>
    </SessionViewProvider>
  )
}

export function SessionTilePane({ storedSessionId }: { storedSessionId: string }) {
  const tiles = useStore($sessionTiles)
  const tile = tiles.find(t => t.storedSessionId === storedSessionId)
  const runtimeId = tile?.runtimeId ?? null
  const gatewayOpen = useStore($gatewayState) === 'open'
  const resumingRef = useRef(false)
  const view = useMemo(() => buildTileView(storedSessionId), [storedSessionId])

  // A tab-strip "+"/⌘T tab is created UNLISTED — its session stays out of
  // $sessions (no sidebar clutter) until it's actually used, so the tab shows
  // "New session". The moment this tile has a message, pull its row into
  // $sessions via the lightweight by-id lookup so the tab (and a sidebar row)
  // resolve the real title. `resolveStoredSession` no-ops when it's already
  // listed, and 404s harmlessly for an in-memory draft that hasn't persisted a
  // turn yet — so we retry across that brief persist lag and stop as soon as it
  // lands (a global turn-complete refresh may beat us to it).
  const hasMessages = useStore(view.$messagesEmpty) === false

  useEffect(() => {
    const alreadyListed = () => $sessions.get().some(s => sessionMatchesStoredId(s, storedSessionId))

    if (!runtimeId || !hasMessages || alreadyListed()) {
      return
    }

    let cancelled = false
    let timer: number | undefined

    const attempt = (remaining: number) => {
      if (cancelled || alreadyListed()) {
        return
      }

      void resolveStoredSession(storedSessionId)
        .then(resolved => {
          if (cancelled || resolved || remaining <= 0) {
            return
          }

          timer = window.setTimeout(() => attempt(remaining - 1), 500)
        })
        .catch(() => undefined)
    }

    attempt(6)

    return () => {
      cancelled = true

      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [hasMessages, runtimeId, storedSessionId])

  // Same gating as the primary's route resume (use-route-resume): never fire
  // session.resume before the gateway is OPEN. Persisted tiles mount at boot
  // while it's still connecting — an ungated resume rejected there and
  // latched every restored tile into the error card.
  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (!gatewayOpen || runtimeId || tile?.error || resumingRef.current) {
      return
    }

    const delegate = sessionTileDelegate()

    if (!delegate) {
      return
    }

    resumingRef.current = true

    delegate
      .resumeTile(storedSessionId)
      .then(id => patchSessionTile(storedSessionId, { error: undefined, runtimeId: id }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)

        // A gone session (404 / "Session not found") is terminal — a stale or
        // cross-profile persisted tile. Discard it instead of latching an error
        // that re-retries on every reconnect (the "Session not found" spam).
        if (/session not found|\b404\b/i.test(message)) {
          discardSessionTile(storedSessionId)
        } else {
          patchSessionTile(storedSessionId, { error: message })
        }
      })
      .finally(() => {
        resumingRef.current = false
      })
  }, [gatewayOpen, runtimeId, storedSessionId, tile?.error])

  // The gateway (re)opening invalidates any latched error — it likely came
  // from a not-yet-open gateway or the previous connection. Clearing it
  // retriggers the resume effect: one bounded auto-retry per (re)connect,
  // mirroring the primary path's became-open resync.
  useEffect(() => {
    if (gatewayOpen && tile?.error) {
      patchSessionTile(storedSessionId, { error: undefined })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayOpen, storedSessionId])

  if (tile?.error) {
    return (
      <div className="grid h-full place-items-center p-4">
        <div className="max-w-[24rem] space-y-2 text-center font-mono text-[11px]">
          <div className="text-(--ui-danger,#f87171)">Couldn't open this session</div>
          <div className="break-words text-(--ui-text-quaternary)">{tile.error}</div>
          <Button onClick={() => patchSessionTile(storedSessionId, { error: undefined })} size="sm" variant="outline">
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!runtimeId) {
    // The SAME session loader the primary thread shows (Thread's
    // loading === 'session' branch) — one loading language everywhere.
    return (
      <div className="relative h-full">
        <CenteredThreadSpinner />
      </div>
    )
  }

  return <TileChat runtimeId={runtimeId} storedSessionId={storedSessionId} view={view} />
}

// ---------------------------------------------------------------------------
// Tile -> pane contribution sync (call once from the app root).
// ---------------------------------------------------------------------------

/** Resolve a tile's stored row: the recents list first, then the project
 *  tree. A session opened as a tab from a project group is often older than
 *  the paginated recents page, so it has no `$sessions` row at all until new
 *  activity lands it there — resolving through the tree keeps its tab titled
 *  and tinted instead of a grey "Session" placeholder. */
export function tileStoredRow(storedSessionId: string): SessionInfo | undefined {
  const match = (s: SessionInfo) => sessionMatchesStoredId(s, storedSessionId)

  return (
    $sessions.get().find(match) ??
    $projectTree
      .get()
      .flatMap(p => [...p.repos.flatMap(r => r.groups.flatMap(g => g.sessions)), ...(p.previewSessions ?? [])])
      .find(match)
  )
}

/** The tab's REGISTERED name. A restored, already-known session may paint before
 *  recents/project rows hydrate, so fall back to the tile's persisted last title
 *  (or the remembered main-session title) instead of flashing "New session". A
 *  true draft still renders its live composer title through `tabTitle`. */
function tileTitle(storedSessionId: string): string {
  const stored = tileStoredRow(storedSessionId)
  const explicit = $sessionTiles.get().find(tile => tile.storedSessionId === storedSessionId)?.workspaceTabTitle
  const remembered = getRememberedSessionTitle($activeGatewayProfile.get(), storedSessionId)

  return stored
    ? sessionTitle(stored)
    : explicit || remembered || ($rememberedSessionRestorePending.get() ? RESTORING_SESSION_TITLE : NEW_SESSION_TITLE)
}

/** The `@session` link payload for a tile tab drag — id + owning profile + title.
 *  Resolved at drag time, so an unsent tab drags under its draft name. */
function tileDragPayload(storedSessionId: string): SessionDragPayload {
  const stored = tileStoredRow(storedSessionId)
  const explicit = $sessionTiles.get().find(tile => tile.storedSessionId === storedSessionId)?.workspaceTabTitle
  const remembered = getRememberedSessionTitle($activeGatewayProfile.get(), storedSessionId)
  const title = stored ? sessionTitle(stored) : explicit || remembered || draftTitleFor(storedSessionId) || NEW_SESSION_TITLE

  return { id: storedSessionId, profile: stored?.profile ?? '', title }
}

// ---------------------------------------------------------------------------
// Closing a tab detaches its pane only. The underlying run keeps going in the
// background, so no confirmation is needed for busy/input-blocked sessions.
// ---------------------------------------------------------------------------

export function requestCloseSessionTile(storedSessionId: string): void {
  closeSessionTile(storedSessionId)
}

/** Kept as a no-op shell mount for compatibility with the app root. */
export function SessionTileCloseConfirm() {
  return null
}

/** Layout reset → every session tile collapses into the MAIN zone as a tab
 *  after the workspace (the primary session stays the first tab), the "smart"
 *  reset: N scattered tiles become one tab bar over the chat instead of
 *  re-docking to their old edges.
 *
 *  Runs BEFORE generic adoption (see registerLayoutResetHandler) — the tiles
 *  aren't in the fresh tree yet, so each `moveTreePane` ADDS the tile into the
 *  workspace group as a tab (append). The main group id is re-read each pass
 *  because appending returns a new tree. */
export function stackSessionTilesIntoMain(): void {
  for (const tile of $sessionTiles.get()) {
    const tree = $layoutTree.get()
    const mainGroup = tree ? findGroupOfPane(tree, 'workspace')?.id : null

    if (mainGroup) {
      moveTreePane(`session-tile:${tile.storedSessionId}`, { groupId: mainGroup, pos: 'center' })
    }
  }
}

/** The three scalars the tab menu actually renders, derived from the stored
 *  row. Subscribing to `$sessions` + `$projectTree` wholesale re-rendered
 *  every tab's menu wrapper on ANY session-list or tree churn (polls, title
 *  updates in other sessions) — for a context menu that's almost never open.
 *  Same class as the TreeGroup fix (#72245): derive narrowly, bail out unless
 *  the derived values change. */
function useTileMenuRow(storedSessionId: string): { pinId: string; profile?: string; title: string } {
  const cache = useRef<{ key: string; value: { pinId: string; profile?: string; title: string } } | null>(null)

  const subscribe = useCallback((onChange: () => void) => {
    const offSessions = $sessions.listen(onChange)
    const offTree = $projectTree.listen(onChange)

    return () => {
      offSessions()
      offTree()
    }
  }, [])

  return useSyncExternalStore(subscribe, () => {
    const stored = tileStoredRow(storedSessionId)
    const pinId = stored ? sessionPinId(stored) : storedSessionId
    const title = tileTitle(storedSessionId)
    const profile = stored?.profile
    const key = `${pinId}\u0000${title}\u0000${profile ?? ''}`

    if (cache.current?.key !== key) {
      cache.current = { key, value: { pinId, profile, title } }
    }

    return cache.current.value
  })
}

/** A session TAB's context menu: the full session verb set (pin, copy id, new
 *  window, branch, rename, archive, delete) — the SAME menu a sidebar row
 *  gets, targeted through the tile delegate (whose verbs are generic over
 *  stored ids, primary included). The wrapper stops the contextmenu from also
 *  opening the zone strip's menu. Shared by tile tabs AND the main tab. */
export function SessionTabMenu({
  children,
  onClose,
  onHideTabBar,
  storedSessionId,
  tabPaneId
}: {
  children: React.ReactElement
  /** Close this tab (tiles; the main tab passes nothing). */
  onClose?: () => void
  /** Hide the zone's tab bar (main tab only — the sticky bar's off switch). */
  onHideTabBar?: () => void
  storedSessionId: string
  /** Layout-tree pane id — powers the Close-others/right/all verbs. */
  tabPaneId: string
}) {
  const { pinId, profile, title } = useTileMenuRow(storedSessionId)
  const pinnedSessionIds = useStore($pinnedSessionIds)
  const pinned = pinnedSessionIds.includes(pinId)

  return (
    <span className="contents" onContextMenu={event => event.stopPropagation()}>
      <SessionContextMenu
        onArchive={() => void sessionTileDelegate()?.archiveSession(storedSessionId)}
        onBranch={() => void sessionTileDelegate()?.branchSession(storedSessionId)}
        onClose={onClose}
        onDelete={() => void sessionTileDelegate()?.deleteSession(storedSessionId)}
        onHideTabBar={onHideTabBar}
        onPin={() => (pinned ? unpinSession(pinId) : pinSession(pinId))}
        pinned={pinned}
        profile={profile}
        sessionId={storedSessionId}
        surface="tab"
        tabPaneId={tabPaneId}
        title={title}
      >
        {children}
      </SessionContextMenu>
    </span>
  )
}

/** The MAIN tab's menu: the same session verbs targeting the primary's loaded
 *  session, plus Close (the tab empties to a fresh draft — the workspace pane
 *  itself never leaves the tree) and the bar's off switch (the bar sticky-shows
 *  once a tab is ever gained; this is the explicit way back). A fresh draft has
 *  no session — no menu. */
export function WorkspaceTabMenu({ children }: { children: React.ReactElement }) {
  const selected = useStore($selectedStoredSessionId)

  if (!selected) {
    return children
  }

  return (
    <SessionTabMenu onClose={() => closeTreePane('workspace')} storedSessionId={selected} tabPaneId="workspace">
      {children}
    </SessionTabMenu>
  )
}

function syncSessionTileTitles(): void {
  for (const tile of $sessionTiles.get()) {
    const stored = tileStoredRow(tile.storedSessionId)
    const title = stored ? sessionTitle(stored) : ''

    if (title && title !== tile.workspaceTabTitle) {
      setRememberedSessionTitle($activeGatewayProfile.get(), tile.storedSessionId, title)
      patchSessionTile(tile.storedSessionId, { workspaceTabTitle: title })
    }
  }
}

/** Keep pane contributions mirroring `$sessionTiles` (+ titles from
 *  `$sessions`). Tiles dock against main on the chosen edge, flex width. */
const watchSessionTilePanes = paneMirror<SessionTile>({
  source: $sessionTiles,
  // $projectTree: a tile whose session is older than the recents page resolves
  // its title through the tree, which loads after the tiles register. (The tab's
  // status dot subscribes to color/state itself, so it needs no `also` entry.)
  also: [$sessions, $projectTree, $rememberedSessionRestorePending],
  key: t => t.storedSessionId,
  prefix: 'session-tile',
  dir: t => t.dir,
  anchor: t => t.anchor,
  before: t => t.before,
  minWidth: '20rem',
  title: tileTitle,
  // The leading tab glyph is stable identity; transient unread/running/attention
  // state sits at the tab's trailing edge so it cannot hide the project color.
  tabLead: storedSessionId => {
    const stored = tileStoredRow(storedSessionId)

    return <SessionTabLead session={stored} storedSessionId={storedSessionId} />
  },
  tabTrailing: storedSessionId => <SessionTabAttentionDot storedSessionId={storedSessionId} />,
  // Until the first turn lists a row there is no title to register, so the tab
  // takes its name from the composer instead — live, without re-registering.
  tabTitle: storedSessionId => {
    if (tileStoredRow(storedSessionId)) {
      return null
    }

    const tile = $sessionTiles.get().find(t => t.storedSessionId === storedSessionId)
    const remembered = getRememberedSessionTitle($activeGatewayProfile.get(), storedSessionId)

    return tile?.workspaceTabTitle || remembered || $rememberedSessionRestorePending.get() ? null : (
      <SessionDraftTitle scope={storedSessionId} />
    )
  },
  tabPreview: storedSessionId => $sessionTiles.get().some(t => t.storedSessionId === storedSessionId && t.preview),
  render: storedSessionId => <SessionTilePane storedSessionId={storedSessionId} />,
  tabWrap: (storedSessionId, tab) => (
    <SessionTabMenu
      onClose={() => requestCloseSessionTile(storedSessionId)}
      storedSessionId={storedSessionId}
      tabPaneId={`session-tile:${storedSessionId}`}
    >
      {tab}
    </SessionTabMenu>
  ),
  // A tile's tab drags like a sidebar row — stack / split / drop-to-link — with
  // its tap (activate) preserved. Preview tabs use double-tap to become
  // permanent instead of the old global "hide the tab bar" gesture.
  tabDrag: (storedSessionId, event, onTap) => {
    const preview = $sessionTiles.get().some(t => t.storedSessionId === storedSessionId && t.preview)

    startSessionDrag(tileDragPayload(storedSessionId), event, {
      double: preview
        ? { key: `promote-session-preview:${storedSessionId}`, onDoubleTap: () => promoteSessionTile(storedSessionId) }
        : undefined,
      onTap
    })

    return true
  },
  close: requestCloseSessionTile
})

export function watchSessionTiles(): void {
  const syncTitles = () => syncSessionTileTitles()

  syncTitles()
  $sessions.listen(syncTitles)
  $projectTree.listen(syncTitles)
  watchSessionTilePanes()
}
