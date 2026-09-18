import { useStore } from '@nanostores/react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { useContributions } from '@/contrib/react/use-contributions'
import { type Translations, useI18n } from '@/i18n'
import { isDesktopFsRemoteMode } from '@/lib/desktop-fs'
import { guardGuestPointers } from '@/lib/guest-pointer-guard'
import { openPreviewTargetInBrowser, remoteHtmlPreviewDocument } from '@/lib/local-preview'
import { rafCoalesce } from '@/lib/raf-coalesce'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import {
  $previewServerRestart,
  failPreviewServerRestart,
  type PreviewTarget,
  updatePreviewTabTarget
} from '@/store/preview'

import { ArtifactPreview } from './preview-artifact'
import {
  clampConsoleHeight,
  compactUrl,
  formatLogLine,
  isNearConsoleBottom,
  PreviewConsolePanel
} from './preview-console'
import { type ConsoleEntry } from './preview-console-state'
import { isPreviewRendererContribution, PREVIEW_RENDERERS_AREA } from './preview-contrib'
import { LocalFilePreview, PreviewEmptyState } from './preview-file'
import { registerPreviewPageReader } from './preview-reader'
import { previewConsoleState } from './preview-strip-tools'

type PreviewWebview = HTMLElement & {
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  closeDevTools?: () => void
  executeJavaScript?: (code: string) => Promise<unknown>
  getTitle?: () => string
  getURL?: () => string
  goBack?: () => void
  goForward?: () => void
  isDevToolsOpened?: () => boolean
  loadURL?: (url: string) => void
  openDevTools?: () => void
  reload?: () => void
  reloadIgnoringCache?: () => void
  stop?: () => void
}

interface ParkedPreviewWebview {
  url: string
  webview: PreviewWebview
}

const parkedPreviewWebviews = new Map<string, ParkedPreviewWebview>()
const discardedPreviewWebviews = new Set<string>()
let previewWebviewParkingLot: HTMLDivElement | null = null

function previewWebviewCacheKey(
  tabId: string | undefined,
  targetKind: PreviewTarget['kind'],
  isWebPreview: boolean,
  isRemoteHtml: boolean
) {
  return isWebPreview && !isRemoteHtml && targetKind === 'url' && tabId ? tabId : null
}

function parkingLot(): HTMLDivElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  if (!previewWebviewParkingLot) {
    previewWebviewParkingLot = document.createElement('div')
    previewWebviewParkingLot.setAttribute('data-preview-webview-parking-lot', '')
    previewWebviewParkingLot.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;opacity:0;'
    document.body.appendChild(previewWebviewParkingLot)
  }

  return previewWebviewParkingLot
}

function safeWebviewUrl(webview: PreviewWebview, fallback: string): string {
  try {
    return webview.getURL?.() || fallback
  } catch {
    return fallback
  }
}

export function clearPreviewWebviewCache(tabId?: string) {
  if (!tabId) {
    for (const { webview } of parkedPreviewWebviews.values()) {
      webview.remove()
    }

    parkedPreviewWebviews.clear()
    discardedPreviewWebviews.clear()
    previewWebviewParkingLot?.remove()
    previewWebviewParkingLot = null

    return
  }

  discardedPreviewWebviews.add(tabId)
  parkedPreviewWebviews.get(tabId)?.webview.remove()
  parkedPreviewWebviews.delete(tabId)
}

interface PreviewPaneProps {
  embedded?: boolean
  onRestartServer?: (url: string, context?: string) => Promise<string>
  reloadRequest?: number
  /** The preview tab this pane renders. Keys the per-tab console store and the
   *  browser-toolbar DevTools handle (see preview-strip-tools). */
  tabId?: string
  target: PreviewTarget
}

interface PreviewLoadErrorState {
  code?: number
  description: string
  url: string
}

const FILE_RELOAD_DEBOUNCE_MS = 200
const SERVER_RESTART_TIMEOUT_MS = 45_000

function loadErrorTitle(error: PreviewLoadErrorState, copy: Translations['preview']['web']): string {
  const description = error.description.toLowerCase()

  if (description.includes('module script') || description.includes('mime type')) {
    return copy.appFailedToBoot
  }

  if (description.includes('connection') || description.includes('refused') || description.includes('not found')) {
    return copy.serverNotFound
  }

  return copy.failedToLoad
}

function isModuleMimeError(message: string): boolean {
  const lower = message.toLowerCase()

  return lower.includes('failed to load module script') && lower.includes('mime type')
}

function normalizeBrowserAddress(value: string): string {
  const trimmed = value.trim()

  if (!trimmed || /^about:/i.test(trimmed)) {
    return trimmed || 'about:blank'
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed
  }

  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#].*)?$/i.test(trimmed)) {
    return `http://${trimmed}`
  }

  if (!/\s/.test(trimmed) && trimmed.includes('.')) {
    return `https://${trimmed}`
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

function PreviewLoadError({
  consoleHeight = 0,
  error,
  onRestartServer,
  onRetry,
  restarting
}: {
  consoleHeight?: number
  error: PreviewLoadErrorState
  onRestartServer?: () => void
  onRetry: () => void
  restarting?: boolean
}) {
  const { t } = useI18n()
  const copy = t.preview.web

  return (
    <PreviewEmptyState
      body={
        <>
          <a
            className="pointer-events-auto block font-mono text-muted-foreground/90 underline decoration-current/20 underline-offset-4 transition-colors hover:text-foreground"
            href={error.url}
            onClick={event => {
              event.preventDefault()
              void window.hermesDesktop?.openExternal(error.url)
            }}
          >
            {compactUrl(error.url)}
            {error.code ? ` (${error.code})` : ''}
          </a>
          <div className="mt-1 text-[0.6875rem] text-muted-foreground/70">{error.description}</div>
        </>
      }
      consoleHeight={consoleHeight}
      primaryAction={{ label: copy.tryAgain, onClick: onRetry }}
      secondaryAction={
        onRestartServer
          ? {
              disabled: restarting,
              label: restarting ? copy.restarting : copy.askRestart,
              onClick: onRestartServer
            }
          : undefined
      }
      title={loadErrorTitle(error, copy)}
    />
  )
}

export function PreviewPane({ embedded = false, onRestartServer, reloadRequest = 0, tabId, target }: PreviewPaneProps) {
  const { t } = useI18n()
  const copy = t.preview.web
  const previewRendererContributions = useContributions(PREVIEW_RENDERERS_AREA)
  // The console store belongs to the TAB, not this render: the toggles live on
  // the tab and must read the same logs this pane appends to.
  const consoleState = previewConsoleState(tabId ?? target.url)
  const consoleBodyRef = useRef<HTMLDivElement | null>(null)
  const consoleShouldStickRef = useRef(true)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const initialTargetUrlRef = useRef(target.url)
  const lastReloadRequestRef = useRef(reloadRequest)
  const lastRestartEventRef = useRef('')
  const previewContentRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<PreviewWebview | null>(null)
  const previewServerRestart = useStore($previewServerRestart)
  const consoleHeight = useStore(consoleState.$height)
  const consoleOpen = useStore(consoleState.$open)
  const [currentUrl, setCurrentUrl] = useState(target.url)
  const currentUrlRef = useRef(target.url)
  const [addressValue, setAddressValue] = useState(target.url)
  const [devtoolsAvailable, setDevtoolsAvailable] = useState(false)
  const [devtoolsOpen, setDevtoolsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PreviewLoadErrorState | null>(null)
  const [localReloadKey, setLocalReloadKey] = useState(0)

  const previewRenderer = useMemo(() => {
    for (const contribution of previewRendererContributions) {
      const renderer = isPreviewRendererContribution(contribution.data) ? contribution.data : null

      if (!renderer) {
        continue
      }

      try {
        if (renderer.matches(target)) {
          return { contribution, renderer }
        }
      } catch (error) {
        console.warn(`[preview-renderer:${contribution.id}] matches() failed`, error)
      }
    }

    return null
  }, [previewRendererContributions, target])

  const renderPreviewContribution = useMemo(
    () => (previewRenderer ? () => previewRenderer.renderer.render({ reloadKey: localReloadKey, target }) : undefined),
    [localReloadKey, previewRenderer, target]
  )

  // Artifacts have no URL to load — they render from the registry, never in a
  // webview.
  const isWebPreview =
    !previewRenderer &&
    target.kind !== 'artifact' &&
    (target.kind === 'url' || (target.previewKind === 'html' && target.renderMode !== 'source'))

  const isRemoteHtmlTarget =
    target.kind === 'file' && target.previewKind === 'html' && Boolean(target.dataUrl || target.transient)

  const isRemoteHtml = isRemoteHtmlTarget && target.renderMode !== 'source' && Boolean(target.dataUrl)

  const remoteHtmlDocument = useMemo(
    () => (isRemoteHtml ? remoteHtmlPreviewDocument(target.dataUrl!) : null),
    [isRemoteHtml, target.dataUrl]
  )

  const currentLabel = compactUrl(currentUrl)

  currentUrlRef.current = currentUrl

  const previewLabel =
    target.label && target.label.replace(/\/$/, '') !== currentLabel.replace(/\/$/, '') ? target.label : currentLabel

  const restartingServer =
    previewServerRestart?.status === 'running' &&
    (previewServerRestart.url === target.url || previewServerRestart.url === currentUrl)

  const persistBrowserLocation = useCallback(
    (url: string, title?: string) => {
      if (target.kind !== 'url' || !tabId) {
        return
      }

      updatePreviewTabTarget(tabId, current =>
        current.kind === 'url'
          ? {
              ...current,
              label: title?.trim() || current.label || compactUrl(url),
              source: current.browserTabKey ? url : current.source,
              url
            }
          : current
      )
    },
    [tabId, target.kind]
  )

  const navigateBrowser = useCallback(
    (raw: string) => {
      const next = normalizeBrowserAddress(raw)
      const webview = webviewRef.current

      setLoadError(null)
      setCurrentUrl(next)
      setAddressValue(next)
      persistBrowserLocation(next)

      if (webview?.loadURL) {
        webview.loadURL(next)
      } else {
        webview?.setAttribute('src', next)
      }
    },
    [persistBrowserLocation]
  )

  const startConsoleResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()

      const handle = event.currentTarget
      const pointerId = event.pointerId
      const startY = event.clientY
      const startHeight = consoleHeight
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      let active = true

      handle.setPointerCapture?.(pointerId)

      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      // The webview above the console must not swallow the gesture.
      const releaseGuests = guardGuestPointers()

      // pointermove outpaces 60fps and each setHeight reflows the webview +
      // console split, so coalesce to one apply per frame (commits on cleanup).
      const resize = rafCoalesce((height: number) => consoleState.setHeight(height))

      const handleMove = (moveEvent: PointerEvent) => {
        if (!active) {
          return
        }

        resize.push(clampConsoleHeight(startHeight + startY - moveEvent.clientY))
      }

      const cleanup = () => {
        if (!active) {
          return
        }

        active = false
        resize.finish()
        releaseGuests()
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        handle.releasePointerCapture?.(pointerId)
        window.removeEventListener('pointermove', handleMove, true)
        window.removeEventListener('pointerup', cleanup, true)
        window.removeEventListener('pointercancel', cleanup, true)
        window.removeEventListener('blur', cleanup)
        handle.removeEventListener('lostpointercapture', cleanup)
      }

      window.addEventListener('pointermove', handleMove, true)
      window.addEventListener('pointerup', cleanup, true)
      window.addEventListener('pointercancel', cleanup, true)
      window.addEventListener('blur', cleanup)
      handle.addEventListener('lostpointercapture', cleanup)
    },
    [consoleHeight, consoleState]
  )

  const reloadPreview = useCallback(() => {
    setLoadError(null)

    if (!isWebPreview) {
      setLocalReloadKey(key => key + 1)

      return
    }

    if (webviewRef.current?.reloadIgnoringCache) {
      webviewRef.current.reloadIgnoringCache()
    } else {
      webviewRef.current?.reload?.()
    }
  }, [isWebPreview])

  const appendConsoleEntry = useCallback(
    (entry: Omit<ConsoleEntry, 'id'>) => {
      consoleShouldStickRef.current = isNearConsoleBottom(consoleBodyRef.current)
      consoleState.append(entry)
    },
    [consoleState]
  )

  const restartServer = useCallback(async () => {
    if (!onRestartServer) {
      return
    }

    // Auto-open the preview console so the user can see progress events
    // streaming back from the background agent. Without this, clicking
    // "Ask Hermes to restart the server" looked like it did nothing —
    // the work was happening, but in a collapsed pane.
    consoleState.setOpen(true)

    try {
      const context = consoleState.$logs.get().slice(-12).map(formatLogLine).join('\n')
      const taskId = await onRestartServer(currentUrl, context || undefined)

      appendConsoleEntry({
        level: 1,
        message: copy.lookingRestart(taskId)
      })

      notify({
        kind: 'info',
        title: copy.restartingTitle,
        message: copy.restartingMessage,
        durationMs: 4000
      })
    } catch (error) {
      appendConsoleEntry({
        level: 2,
        message: copy.startRestartFailed(error instanceof Error ? error.message : String(error))
      })
      notifyError(error, copy.restartFailed)
    }
  }, [appendConsoleEntry, consoleState, copy, currentUrl, onRestartServer])

  const toggleDevTools = useCallback(() => {
    const webview = webviewRef.current

    if (!webview?.openDevTools) {
      return
    }

    if (webview.isDevToolsOpened?.()) {
      webview.closeDevTools?.()

      return
    }

    webview.openDevTools()
  }, [])

  // Publish the PAGE reader for this tab (the read_preview tool): extract the
  // rendered page's title + visible text from the webview. innerText (not
  // textContent) so hidden nodes and script/style bodies stay out, matching
  // what the user actually sees.
  useEffect(() => {
    if (!isWebPreview || !tabId) {
      return
    }

    return registerPreviewPageReader(tabId, async () => {
      const webview = webviewRef.current

      if (!webview?.executeJavaScript) {
        throw new Error('preview webview is not ready')
      }

      const text = await webview.executeJavaScript('document.body ? document.body.innerText : ""')

      return {
        text: typeof text === 'string' ? text : '',
        title: webview.getTitle?.() ?? '',
        url: webview.getURL?.() ?? ''
      }
    })
  }, [isWebPreview, tabId])

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (!consoleOpen) {
      return
    }

    consoleShouldStickRef.current = true

    const handle = window.requestAnimationFrame(() => {
      const consoleBody = consoleBodyRef.current
      consoleBody?.scrollTo({ top: consoleBody.scrollHeight })
    })

    return () => window.cancelAnimationFrame(handle)
  }, [consoleOpen])

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (
      !previewServerRestart ||
      !previewServerRestart.message ||
      (previewServerRestart.url !== target.url && previewServerRestart.url !== currentUrl)
    ) {
      return
    }

    const eventKey = `${previewServerRestart.taskId}:${previewServerRestart.status}:${previewServerRestart.message || ''}`

    if (eventKey === lastRestartEventRef.current) {
      return
    }

    lastRestartEventRef.current = eventKey
    appendConsoleEntry({
      level: previewServerRestart.status === 'error' ? 2 : 1,
      message:
        previewServerRestart.status === 'running'
          ? previewServerRestart.message
          : previewServerRestart.status === 'complete'
            ? copy.finishedRestarting(previewServerRestart.message)
            : copy.failedRestarting(previewServerRestart.message || copy.unknownError)
    })

    if (previewServerRestart.status === 'complete') {
      reloadPreview()
      notify({
        kind: 'success',
        title: copy.restartedTitle,
        message: previewServerRestart.message?.slice(0, 160) || copy.reloadingNow,
        durationMs: 3500
      })
    } else if (previewServerRestart.status === 'error') {
      notify({
        kind: 'warning',
        title: copy.restartFailedTitle,
        message: previewServerRestart.message?.slice(0, 200) || copy.restartFailedMessage,
        durationMs: 6000
      })
    }
  }, [appendConsoleEntry, copy, currentUrl, previewServerRestart, reloadPreview, target.url])

  useEffect(() => {
    if (!restartingServer || !previewServerRestart) {
      return
    }

    const taskId = previewServerRestart.taskId

    const timer = window.setTimeout(() => {
      failPreviewServerRestart(taskId, copy.stillWorking)
    }, SERVER_RESTART_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [copy.stillWorking, previewServerRestart, restartingServer])

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (reloadRequest === lastReloadRequestRef.current) {
      return
    }

    lastReloadRequestRef.current = reloadRequest

    if (target.kind !== 'url') {
      return
    }

    appendConsoleEntry({
      level: 1,
      message: copy.workspaceReloading
    })
    reloadPreview()
  }, [appendConsoleEntry, copy.workspaceReloading, reloadPreview, reloadRequest, target.kind])

  useEffect(() => {
    if (
      target.kind !== 'file' ||
      isDesktopFsRemoteMode() ||
      !window.hermesDesktop?.watchPreviewFile ||
      !window.hermesDesktop?.onPreviewFileChanged
    ) {
      return
    }

    let active = true
    let pendingReloadCount = 0
    let pendingReloadUrl = ''
    let reloadTimer: ReturnType<typeof setTimeout> | null = null
    let watchId = ''

    const flushReload = () => {
      if (!active || pendingReloadCount === 0) {
        return
      }

      const changedCount = pendingReloadCount
      const changedUrl = pendingReloadUrl

      pendingReloadCount = 0
      pendingReloadUrl = ''

      appendConsoleEntry({
        level: 1,
        message:
          changedCount === 1
            ? copy.fileChanged(compactUrl(changedUrl))
            : copy.filesChanged(changedCount, compactUrl(changedUrl))
      })

      reloadPreview()
    }

    const unsubscribe = window.hermesDesktop.onPreviewFileChanged(payload => {
      if (!active || payload.id !== watchId) {
        return
      }

      pendingReloadCount += 1
      pendingReloadUrl = payload.url

      if (reloadTimer) {
        clearTimeout(reloadTimer)
      }

      reloadTimer = setTimeout(() => {
        reloadTimer = null
        flushReload()
      }, FILE_RELOAD_DEBOUNCE_MS)
    })

    void window.hermesDesktop
      .watchPreviewFile(target.url)
      .then(watch => {
        if (!active) {
          void window.hermesDesktop?.stopPreviewFileWatch?.(watch.id)

          return
        }

        watchId = watch.id
      })
      .catch(error => {
        appendConsoleEntry({
          level: 2,
          message: copy.watchFailed(error instanceof Error ? error.message : String(error))
        })
      })

    return () => {
      active = false
      unsubscribe()

      if (reloadTimer) {
        clearTimeout(reloadTimer)
      }

      if (watchId) {
        void window.hermesDesktop?.stopPreviewFileWatch?.(watchId)
      }
    }
  }, [appendConsoleEntry, copy, reloadPreview, target.kind, target.url])

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return
    }

    const cacheKey = previewWebviewCacheKey(tabId, target.kind, isWebPreview, isRemoteHtml)
    const parked = cacheKey ? parkedPreviewWebviews.get(cacheKey) : undefined
    const initialUrl = parked?.url || initialTargetUrlRef.current

    host.replaceChildren()
    webviewRef.current = null
    setDevtoolsAvailable(false)
    setCurrentUrl(initialUrl)
    setAddressValue(initialUrl)
    setDevtoolsOpen(false)
    setLoadError(null)

    if (!parked) {
      consoleState.reset()
    }

    setLoading(!parked)

    if (!isWebPreview || isRemoteHtml) {
      setLoading(false)

      return
    }

    const webview = parked?.webview ?? (document.createElement('webview') as PreviewWebview)

    if (parked && cacheKey) {
      parkedPreviewWebviews.delete(cacheKey)
      discardedPreviewWebviews.delete(cacheKey)
    }

    webview.className = 'flex h-full w-full flex-1 bg-transparent'
    webview.setAttribute('allowpopups', '')
    webview.setAttribute('partition', 'persist:hermes-preview')
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')

    if (!parked) {
      webview.setAttribute('src', initialUrl)
    }

    const onConsole = (event: Event) => {
      const detail = event as Event & {
        level?: number
        line?: number
        message?: string
        sourceId?: string
      }

      const message = detail.message || ''

      appendConsoleEntry({
        level: detail.level ?? 0,
        line: detail.line,
        message,
        source: detail.sourceId
      })

      if ((detail.level ?? 0) >= 3 && isModuleMimeError(message)) {
        setLoadError({
          description: copy.moduleMimeDescription,
          url: webview.getURL?.() || initialUrl
        })
        setLoading(false)
      }
    }

    const onNavigate = (event: Event) => {
      const detail = event as Event & { url?: string }

      if (detail.url) {
        setLoadError(null)
        setCurrentUrl(detail.url)
        setAddressValue(detail.url)
        persistBrowserLocation(detail.url)
      }
    }

    const onTitle = (event: Event) => {
      const detail = event as Event & { title?: string }
      const title = detail.title || webview.getTitle?.() || ''
      const url = webview.getURL?.() || initialUrl

      if (title || url) {
        persistBrowserLocation(url, title)
      }
    }

    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number
        errorDescription?: string
        validatedURL?: string
      }

      const errorCode = detail.errorCode

      if (errorCode === -3) {
        return
      }

      appendConsoleEntry({
        level: 3,
        message: copy.loadFailedConsole(errorCode, detail.errorDescription || detail.validatedURL || copy.unknownError)
      })
      setLoadError({
        code: errorCode,
        description: detail.errorDescription || copy.unreachableDescription,
        url: detail.validatedURL || webview.getURL?.() || initialUrl
      })
      setLoading(false)
    }

    const onStart = () => setLoading(true)
    const onStop = () => setLoading(false)
    // The WEBVIEW is the source of truth for DevTools, not our click handler:
    // closing the DevTools window itself fires devtools-closed with no click,
    // and the glyph was left stuck "on" when we tracked it locally.
    const onDevToolsOpened = () => setDevtoolsOpen(true)
    const onDevToolsClosed = () => setDevtoolsOpen(false)

    webview.addEventListener('console-message', onConsole)
    webview.addEventListener('devtools-closed', onDevToolsClosed)
    webview.addEventListener('devtools-opened', onDevToolsOpened)
    webview.addEventListener('did-fail-load', onFail)
    webview.addEventListener('did-navigate', onNavigate)
    webview.addEventListener('did-navigate-in-page', onNavigate)
    webview.addEventListener('did-start-loading', onStart)
    webview.addEventListener('did-stop-loading', onStop)
    webview.addEventListener('page-title-updated', onTitle)
    host.appendChild(webview)
    webviewRef.current = webview
    setDevtoolsAvailable(Boolean(webview.openDevTools))

    return () => {
      setDevtoolsAvailable(false)
      webview.removeEventListener('console-message', onConsole)
      webview.removeEventListener('devtools-closed', onDevToolsClosed)
      webview.removeEventListener('devtools-opened', onDevToolsOpened)
      webview.removeEventListener('did-fail-load', onFail)
      webview.removeEventListener('did-navigate', onNavigate)
      webview.removeEventListener('did-navigate-in-page', onNavigate)
      webview.removeEventListener('did-start-loading', onStart)
      webview.removeEventListener('did-stop-loading', onStop)
      webview.removeEventListener('page-title-updated', onTitle)

      if (cacheKey && !discardedPreviewWebviews.has(cacheKey)) {
        const parkedUrl = safeWebviewUrl(webview, currentUrlRef.current)

        parkingLot()?.appendChild(webview)
        parkedPreviewWebviews.set(cacheKey, { url: parkedUrl, webview })
      } else {
        webview.remove()

        if (cacheKey) {
          discardedPreviewWebviews.delete(cacheKey)
          parkedPreviewWebviews.delete(cacheKey)
        }
      }
    }
  }, [appendConsoleEntry, consoleState, copy, isRemoteHtml, isWebPreview, persistBrowserLocation, tabId, target.kind])

  return (
    <aside className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-transparent text-muted-foreground">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {(!embedded || target.kind === 'url') && (
          <div className="pointer-events-none flex min-h-(--titlebar-height) items-center gap-1.5 border-b border-border/60 bg-background px-2 py-1">
            {target.kind === 'url' ? (
              <form
                className="pointer-events-auto flex min-w-0 flex-1 items-center gap-1.5"
                onSubmit={event => {
                  event.preventDefault()
                  navigateBrowser(addressValue)
                }}
              >
                <button
                  aria-label="Back"
                  className="grid size-6 shrink-0 place-items-center rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  onClick={() => webviewRef.current?.goBack?.()}
                  type="button"
                >
                  ←
                </button>
                <button
                  aria-label="Forward"
                  className="grid size-6 shrink-0 place-items-center rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  onClick={() => webviewRef.current?.goForward?.()}
                  type="button"
                >
                  →
                </button>
                <button
                  aria-label={loading ? 'Stop loading' : 'Reload'}
                  className="grid size-6 shrink-0 place-items-center rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => (loading ? webviewRef.current?.stop?.() : reloadPreview())}
                  type="button"
                >
                  {loading ? '×' : '↻'}
                </button>
                <input
                  aria-label="Web address"
                  className="h-6 min-w-0 flex-1 rounded-md border border-border/70 bg-muted/40 px-2 font-mono text-[0.6875rem] text-foreground outline-none transition focus:border-primary/70 focus:bg-background"
                  onChange={event => setAddressValue(event.currentTarget.value)}
                  onFocus={event => event.currentTarget.select()}
                  placeholder="Search or enter address"
                  value={addressValue}
                />
                <button
                  className="h-6 shrink-0 rounded-md border border-border/70 px-2 text-[0.6875rem] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  type="submit"
                >
                  Go
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={copy.browserTools}
                      className="grid size-6 shrink-0 place-items-center rounded-md border border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={copy.browserTools}
                      type="button"
                    >
                      <Codicon name="tools" size="0.875rem" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48" sideOffset={6}>
                    <DropdownMenuItem onSelect={() => consoleState.setOpen(open => !open)}>
                      <Codicon name="output" size="0.8125rem" />
                      <span className="flex-1">{consoleOpen ? copy.hideConsole : copy.showConsole}</span>
                      {consoleOpen && <Codicon name="check" size="0.75rem" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!devtoolsAvailable} onSelect={toggleDevTools}>
                      <Codicon name="debug-alt" size="0.8125rem" />
                      <span className="flex-1">{devtoolsOpen ? copy.hideDevTools : copy.openDevTools}</span>
                      {devtoolsOpen && <Codicon name="check" size="0.75rem" />}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </form>
            ) : (
              <div className="min-w-0 flex-1">
                <Tip label={copy.openTarget(currentUrl)}>
                  <a
                    className="pointer-events-auto inline max-w-full truncate text-left text-xs font-medium text-foreground underline-offset-4 decoration-current/20 transition-colors hover:text-primary hover:underline"
                    href={isRemoteHtmlTarget ? undefined : currentUrl}
                    onClick={event => {
                      if (isRemoteHtmlTarget) {
                        event.preventDefault()
                        void openPreviewTargetInBrowser(target).catch(error =>
                          notifyError(error, t.preview.unavailable)
                        )
                      }
                    }}
                    rel="noreferrer"
                    target={isRemoteHtmlTarget ? undefined : '_blank'}
                  >
                    {previewLabel || copy.fallbackTitle}
                  </a>
                </Tip>
              </div>
            )}
          </div>
        )}

        <div
          className="pointer-events-auto relative min-h-0 flex-1 overflow-hidden bg-transparent"
          ref={previewContentRef}
        >
          <div
            className={cn(
              'absolute inset-0 flex bg-transparent',
              (isRemoteHtml || !isWebPreview || loadError) && 'pointer-events-none opacity-0'
            )}
            ref={hostRef}
          />
          {isRemoteHtml && (
            <iframe
              className="absolute inset-0 size-full border-0 bg-white"
              referrerPolicy="no-referrer"
              sandbox=""
              srcDoc={remoteHtmlDocument || ''}
              title={target.label || copy.fallbackTitle}
            />
          )}
          {!isWebPreview &&
            (target.kind === 'artifact' ? (
              <ArtifactPreview target={target} />
            ) : previewRenderer ? (
              <ContribBoundary id={previewRenderer.contribution.id}>
                <ContribRender render={renderPreviewContribution!} />
              </ContribBoundary>
            ) : (
              <LocalFilePreview reloadKey={localReloadKey} target={target} />
            ))}
          {loadError && (
            <PreviewLoadError
              consoleHeight={consoleOpen ? consoleHeight : 0}
              error={loadError}
              onRestartServer={target.kind === 'url' && onRestartServer ? () => void restartServer() : undefined}
              onRetry={reloadPreview}
              restarting={restartingServer}
            />
          )}

          {isWebPreview && !isRemoteHtml && consoleOpen && (
            <PreviewConsolePanel
              consoleBodyRef={consoleBodyRef}
              consoleShouldStickRef={consoleShouldStickRef}
              consoleState={consoleState}
              startConsoleResize={startConsoleResize}
            />
          )}
        </div>
      </div>
    </aside>
  )
}
