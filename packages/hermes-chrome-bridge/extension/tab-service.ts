export interface BrowserTabLike {
  active?: boolean
  id?: number
  title?: string
  url?: string
  windowId?: number
}

interface RemovedTabsEventLike {
  addListener(listener: (tabId: number) => void): void
}

export interface TabsApiLike {
  get(tabId: number): Promise<BrowserTabLike>
  onRemoved: RemovedTabsEventLike
  query(queryInfo: Record<string, never>): Promise<BrowserTabLike[]>
}

export interface SafeTab {
  active: boolean
  selected: boolean
  tabId: number
  title: string
  titleRedacted: boolean
  titleTruncated: boolean
  url: string
  urlRedacted: boolean
  urlTruncated: boolean
  windowId: number
}

export interface TabListResult {
  count: number
  selectedTabId?: number
  tabs: SafeTab[]
  truncated: boolean
}

export class TabServiceError extends Error {
  public constructor(public readonly code: 'TAB_NOT_CONTROLLABLE' | 'TAB_NOT_FOUND', message: string) {
    super(message)
    this.name = 'TabServiceError'
  }
}

const MAX_TITLE_LENGTH = 160
const MAX_URL_LENGTH = 512
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const CARD = /\b(?:\d[ -]*?){13,19}\b/gu
const ASSIGNED_SECRET = /\b(?:api[-_ ]?key|authorization|bearer|password|secret|token)\s*[:=]\s*[^\s,;]+/giu
const PREFIXED_TOKEN = /\b(?:gh[pousr]_|sk[-_](?:live|test)[-_]|eyJ)[A-Za-z0-9._~-]{8,}/gu

function truncate(value: string, maximum: number): { truncated: boolean, value: string } {
  if (value.length <= maximum) { return { truncated: false, value } }

  return { truncated: true, value: value.slice(0, maximum - 1) + '…' }
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0)

  return code <= 31 || code === 127
}

function scrubText(value: string): { redacted: boolean, value: string } {
  let redacted = [...value].some(isControlCharacter)
  let safe = [...value].filter(character => !isControlCharacter(character)).join('')

  for (const pattern of [EMAIL, CARD, ASSIGNED_SECRET, PREFIXED_TOKEN]) {
    pattern.lastIndex = 0

    if (pattern.test(safe)) { redacted = true }
    pattern.lastIndex = 0

    safe = safe.replace(pattern, '[redacted]')
  }

  return { redacted, value: safe }
}

function isSensitivePathSegment(segment: string): boolean {
  let decoded = segment

  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return true
  }

  EMAIL.lastIndex = 0
  CARD.lastIndex = 0
  PREFIXED_TOKEN.lastIndex = 0

  if (EMAIL.test(decoded) || CARD.test(decoded) || PREFIXED_TOKEN.test(decoded)) { return true }

  if (/^(?:token|secret|password|auth|session)[-_:]/iu.test(decoded)) { return true }

  return decoded.length >= 20 && /[A-Za-z]/u.test(decoded) && /\d/u.test(decoded) &&
    /^[A-Za-z0-9._~-]+$/u.test(decoded)
}

function safeUrl(raw: string): { redacted: boolean, truncated: boolean, value: string } | undefined {
  if ([...raw].some(isControlCharacter)) { return undefined }

  let parsed: URL

  try {
    parsed = new URL(raw)
  } catch {
    return undefined
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname.length === 0) {
    return undefined
  }

  let redacted = parsed.username.length > 0 || parsed.password.length > 0 ||
    parsed.search.length > 0 || parsed.hash.length > 0

  const segments = parsed.pathname.split('/').map(segment => {
    if (segment.length > 0 && isSensitivePathSegment(segment)) {
      redacted = true

      return '[redacted]'
    }

    return segment
  })

  const pathname = segments.join('/')

  const port = parsed.port.length === 0 ? '' : `:${parsed.port}`
  const rendered = `${parsed.protocol}//${parsed.hostname}${port}${pathname}`
  const bounded = truncate(rendered, MAX_URL_LENGTH)

  return { redacted, truncated: bounded.truncated, value: bounded.value }
}

export function redactTab(tab: BrowserTabLike, selected: boolean): SafeTab | undefined {
  if (!Number.isInteger(tab.id) || (tab.id ?? 0) <= 0 || !Number.isInteger(tab.windowId)) { return undefined }

  if (typeof tab.url !== 'string') { return undefined }

  const url = safeUrl(tab.url)

  if (url === undefined) { return undefined }
  const scrubbedTitle = scrubText(typeof tab.title === 'string' ? tab.title : '')
  const title = truncate(scrubbedTitle.value, MAX_TITLE_LENGTH)

  return {
    active: tab.active === true,
    selected,
    tabId: tab.id as number,
    title: title.value,
    titleRedacted: scrubbedTitle.redacted,
    titleTruncated: title.truncated,
    url: url.value,
    urlRedacted: url.redacted,
    urlTruncated: url.truncated,
    windowId: tab.windowId as number
  }
}

export interface TabService {
  getSelectedTabId(): number | undefined
  list(): Promise<TabListResult>
  select(tabId: number): Promise<{ selectedTabId: number }>
}

export function createTabService(api: TabsApiLike, options: { maxTabs?: number } = {}): TabService {
  const maxTabs = Math.max(1, Math.min(100, options.maxTabs ?? 100))
  let selectedTabId: number | undefined

  api.onRemoved.addListener(tabId => {
    if (selectedTabId === tabId) { selectedTabId = undefined }
  })

  return {
    getSelectedTabId: () => selectedTabId,

    async list(): Promise<TabListResult> {
      const safe = (await api.query({}))
        .map(tab => redactTab(tab, false))
        .filter((tab): tab is SafeTab => tab !== undefined)
        .sort((left, right) => left.windowId - right.windowId || left.tabId - right.tabId)

      const knownSelected = selectedTabId === undefined
        ? undefined
        : safe.find(tab => tab.tabId === selectedTabId)

      if (knownSelected === undefined) {
        selectedTabId = safe.find(tab => tab.active)?.tabId ?? safe[0]?.tabId
      }

      let tabs = safe.slice(0, maxTabs)
      const selected = safe.find(tab => tab.tabId === selectedTabId)

      if (selected !== undefined && !tabs.some(tab => tab.tabId === selected.tabId)) {
        tabs = [...tabs.slice(0, -1), selected]
          .sort((left, right) => left.windowId - right.windowId || left.tabId - right.tabId)
      }

      tabs = tabs.map(tab => ({ ...tab, selected: tab.tabId === selectedTabId }))

      return {
        count: tabs.length,
        ...(selectedTabId === undefined ? {} : { selectedTabId }),
        tabs,
        truncated: safe.length > tabs.length
      }
    },

    async select(tabId: number): Promise<{ selectedTabId: number }> {
      let tab: BrowserTabLike

      try {
        tab = await api.get(tabId)
      } catch {
        throw new TabServiceError('TAB_NOT_FOUND', 'The requested tab does not exist.')
      }

      if (redactTab(tab, true) === undefined) {
        throw new TabServiceError('TAB_NOT_CONTROLLABLE', 'The requested tab is not controllable.')
      }

      selectedTabId = tabId

      return { selectedTabId }
    }
  }
}
