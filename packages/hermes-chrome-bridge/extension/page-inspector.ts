export type SnapshotFormat = 'accessibility' | 'both' | 'dom'

export interface BoundingBox {
  height: number
  width: number
  x: number
  y: number
}

export interface SafePageElement {
  boundingBox?: BoundingBox
  checked?: boolean
  disabled?: boolean
  expanded?: boolean
  name?: string
  ref?: string
  role?: string
  selected?: boolean
  sensitive?: boolean
  tag?: string
  text?: string
  value?: string
}

export interface PageInspectionResult {
  inaccessibleFrames?: Array<{ ref: string, reason: 'inaccessible' }>
  nextCursor?: string
  count: number
  elements: SafePageElement[]
  format: SnapshotFormat
  truncated: boolean
  version: 1
}

export class PageInspectorError extends Error {
  public constructor(public readonly code: 'ELEMENT_NOT_FOUND' | 'INVALID_SELECTOR', message: string) {
    super(message)
    this.name = 'PageInspectorError'
  }
}

export interface InspectionOptions {
  selector?: string
  limit?: number
  cursor?: string
  maxChars?: number
  fields?: string[]
  visibleOnly?: boolean
}

export interface PageInspector {
  dispose?(): void
  locate?(target: string): { ref: string, sensitive: boolean, editable: boolean, box: BoundingBox, documentId: string, locator: { steps: Array<{ kind: string, selector: string }> } }
  resolve(target: string): { element: Element, ref: string, sensitive: boolean }
  query(options: InspectionOptions): PageInspectionResult
  snapshot(options: InspectionOptions & { format: SnapshotFormat }): PageInspectionResult
}

const MAX_ELEMENTS = 500
const MAX_TEXT_LENGTH = 240
const EXCLUDED_TAGS = new Set(['HEAD', 'LINK', 'META', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE'])
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const CARD = /\b(?:\d[ -]*?){13,19}\b/gu
const ASSIGNED_SECRET = /\b(?:api[-_ ]?key|authorization|bearer|password|secret|token)\s*[:=]\s*[^\s,;]+/giu
const PREFIXED_TOKEN = /\b(?:gh[pousr]_|sk[-_](?:live|test)[-_]|eyJ)[A-Za-z0-9._~-]{8,}/gu
const SENSITIVE_IDENTITY = /(?:api[-_ ]?(?:key|token)|access[-_ ]?token|auth(?:orization)?|bearer|client[-_ ]?secret|credential|password|passcode|secret|token|one[-_ ]?time|2fa|otp|card|cc[-_ ]?(?:csc|cvv|exp|number)|cvv|cvc|security[-_ ]?code|expiry|expiration)/iu
const ROLE_LIST = /^[a-z][a-z0-9-]{0,63}(?:\s+[a-z][a-z0-9-]{0,63})*$/u

function shadowRootFor(element: Element): ShadowRoot | null {
  return element.shadowRoot ?? (typeof chrome !== 'undefined' ? chrome.dom?.openOrClosedShadowRoot(element as HTMLElement) : null) ?? null
}

function clampLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) { return maximum }

  return Math.max(1, Math.min(maximum, Math.trunc(value)))
}

function bound(value: string, maximum = 240): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`
}

function redactText(value: string): string {
  let safe = value.replaceAll(/\s+/gu, ' ').trim()

  for (const pattern of [EMAIL, CARD, ASSIGNED_SECRET, PREFIXED_TOKEN]) {
    pattern.lastIndex = 0
    safe = safe.replace(pattern, '[redacted]')
  }

  return bound(safe)
}

function attribute(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name)

  return value === null ? undefined : value
}

function isSensitive(element: Element): boolean {
  const type = attribute(element, 'type')?.toLowerCase()
  const autocomplete = attribute(element, 'autocomplete')?.toLowerCase().trim() ?? ''
  const autocompleteTokens = autocomplete.split(/\s+/u)

  const isControl = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' || attribute(element, 'contenteditable') === 'true'

  if (!isControl) { return false }

  const identity = [
    attribute(element, 'id'),
    attribute(element, 'name'),
    attribute(element, 'aria-label'),
    attribute(element, 'placeholder'),
    labelledText(element),
    referencedLabelText(element)
  ].filter((value): value is string => value !== undefined).join(' ')

  return type === 'password' ||
    autocompleteTokens.some(token => token === 'current-password' || token === 'new-password' ||
      token === 'one-time-code' || token === 'username' || token.startsWith('cc-')) ||
    SENSITIVE_IDENTITY.test(identity)
}

function inferRole(element: Element): string | undefined {
  const explicit = attribute(element, 'role')

  if (explicit !== undefined) {
    const normalized = explicit.toLowerCase().replaceAll(/\s+/gu, ' ').trim()

    if (normalized.length > 0 && normalized.length <= MAX_TEXT_LENGTH && ROLE_LIST.test(normalized)) {
      return normalized
    }
  }

  const type = attribute(element, 'type')?.toLowerCase()

  const roles: Record<string, string> = {
    A: attribute(element, 'href') === undefined ? '' : 'link',
    BUTTON: 'button',
    H1: 'heading',
    H2: 'heading',
    H3: 'heading',
    H4: 'heading',
    H5: 'heading',
    H6: 'heading',
    IMG: 'img',
    LI: 'listitem',
    OPTION: 'option',
    SELECT: 'combobox',
    SUMMARY: 'button',
    TEXTAREA: 'textbox'
  }

  if (element.tagName === 'INPUT') {
    if (type === 'checkbox') { return 'checkbox' }

    if (type === 'radio') { return 'radio' }

    if (type === 'button' || type === 'submit' || type === 'reset') { return 'button' }

    return 'textbox'
  }

  return roles[element.tagName] || undefined
}

function labelledText(element: Element): string | undefined {
  const labels = (element as Element & { labels?: ArrayLike<Element> | null }).labels

  // Native HTMLInputElement.labels is null for hidden inputs, not an empty list.
  if (labels === undefined || labels === null) { return undefined }

  const text = Array.from(labels)
    .map(label => safeText(label, true))
    .join(' ')

  return text.length === 0 ? undefined : text
}

function referencedLabelText(element: Element): string | undefined {
  const owner = (element as Element & { ownerDocument?: Document }).ownerDocument

  if (owner === undefined) { return undefined }

  const ids = attribute(element, 'aria-labelledby')?.split(/\s+/u).filter(Boolean) ?? []

  const labelledBy = ids
    .map(id => (owner.getElementById(id) ? safeText(owner.getElementById(id)!, true) : ''))
    .join(' ')

  const id = attribute(element, 'id')

  const explicit = id === undefined
    ? ''
    : [...owner.querySelectorAll('label[for]')]
      .filter(label => label.getAttribute('for') === id)
      .map(label => safeText(label, true))
      .join(' ')

  const wrapping = (element.closest('label') ? safeText(element.closest('label')!, true) : '')
  const text = `${labelledBy} ${explicit} ${wrapping}`.trim()

  return text.length === 0 ? undefined : text
}

function accessibleName(element: Element): string | undefined {
  const value = attribute(element, 'aria-label') ??
    labelledText(element) ??
    referencedLabelText(element) ??
    attribute(element, 'alt') ??
    attribute(element, 'title') ??
    attribute(element, 'placeholder') ??
    safeText(element, actionable(element))

  if (value === undefined) { return undefined }
  const safe = redactText(value)

  return safe.length === 0 ? undefined : safe
}

function finite(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
}

function boundingBox(element: Element): BoundingBox {
  const rectangle = element.getBoundingClientRect()

  return {
    height: Math.max(0, finite(rectangle.height)),
    width: Math.max(0, finite(rectangle.width)),
    x: finite(rectangle.x),
    y: finite(rectangle.y)
  }
}

function booleanState(element: Element, property: 'checked' | 'disabled' | 'selected'): boolean | undefined {
  const value = (element as Element & Record<typeof property, unknown>)[property]

  if (typeof value === 'boolean') { return value }

  if (element.hasAttribute(property)) { return true }

  return undefined
}

function isEligible(element: Element): boolean {
  return !EXCLUDED_TAGS.has(element.tagName) &&
    attribute(element, 'aria-hidden') !== 'true' &&
    attribute(element, 'data-hermes-chrome-control') !== 'true'
}

function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement ?? (node.getRootNode?.() as ShadowRoot | undefined)?.host ?? null) {
    if (!isEligible(node) || node.hasAttribute('hidden') || attribute(node, 'type') === 'hidden') { return false }
    const style = node.ownerDocument?.defaultView?.getComputedStyle(node)

    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') { return false }
  }

  return true
}

// Never use ancestor textContent: it includes executable and hidden descendants.
function safeText(element: Element, recursive = false, budget = { nodes: 256, chars: 2048 }): string {
  if (!visible(element) || budget.nodes-- <= 0 || budget.chars <= 0) { return '' }

  if (!element.childNodes) { return element.textContent ?? '' }
  let text = ''

  for (const node of element.childNodes) {
    if (budget.nodes-- <= 0 || budget.chars <= 0) { break }

    if (node.nodeType === 3) {
      const chunk = (node.textContent ?? '').slice(0, budget.chars)
      text += chunk; budget.chars -= chunk.length
    }
    else if (recursive && node.nodeType === 1 && visible(node as Element)) {
      const child = node as Element

      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(child.tagName) && attribute(child, 'contenteditable') !== 'true') {
        text += ` ${safeText(child, true, budget)}`
      }
    }

    if (text.length > 2048) { break }
  }

  return text
}

function actionable(element: Element): boolean {
  return /^(button|link|textbox|checkbox|radio|combobox|option|switch|slider|menuitem)$/.test(inferRole(element) ?? '') ||
    element.hasAttribute('tabindex') || attribute(element, 'contenteditable') === 'true'
}

export function createPageInspector(
  document: Document,
  options: { maxElements?: number } = {}
): PageInspector {
  const refs = new WeakMap<Element, string>()
  const elementsByRef = new Map<string, Element>()
  let nextRef = 1
  let revision = 0
  type Scan = { iterator: Generator<Element>, pending: Element[], done: boolean, frames: Array<{ref: string, reason: 'inaccessible'}>, roots: Array<{root: Document | ShadowRoot, url: string}> }
  const cursors = new Map<string, { key: string, revision: number, scan: Scan }>()
  const instance = Array.from(crypto.getRandomValues(new Uint32Array(2)), value => value.toString(36)).join('-')
  const documents = new WeakMap<Document, number>()
  const observed = new WeakSet<Node>()
  let nextDocument = 1

  const observe = (root: Document | ShadowRoot) => {
    if (!observed.has(root)) { observer?.observe(root, { subtree: true, childList: true, attributes: true, characterData: true }); observed.add(root) }
  }

  const active = (element: Element): boolean => {
    if (element.isConnected === false) { return false }
    let owner = element.ownerDocument

    while (owner && owner !== document) {
      const frame = owner.defaultView?.frameElement as HTMLIFrameElement | null

      if (!frame || !frame.isConnected || frame.contentDocument !== owner) { return false }
      owner = frame.ownerDocument
    }

    return !document.defaultView || document.defaultView.document === document
  }

  const collect = (selector: string, visibleOnly: boolean) => {
    const matched: Element[] = []
    const inaccessibleFrames: Array<{ ref: string, reason: 'inaccessible' }> = []

    const visit = (root: Document | ShadowRoot) => {
      if (root.nodeType) { observe(root) }
      const selected = new Set(root.querySelectorAll(selector))

      for (const element of root.querySelectorAll('*')) {
        if (selected.has(element)) { matched.push(element) }

        if (visibleOnly && !visible(element)) { continue }

        const shadow = shadowRootFor(element)

        if (shadow) { visit(shadow) }

        if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
          const frame = element as HTMLIFrameElement
          let child: Document | null = null

          try { child = frame.contentDocument } catch { /* cross-origin */ }

          if (child) { visit(child) }
          else { inaccessibleFrames.push({ ref: refFor(element), reason: 'inaccessible' }) }
        }
      }
    }

    visit(document)

    return { matched, inaccessibleFrames }
  }

  const newScan = (selector: string, visibleOnly: boolean): Scan => {
    const scan: Scan = { iterator: undefined as unknown as Generator<Element>, pending: [], done: false, frames: [], roots: [] }

    function* walk(root: Document | ShadowRoot): Generator<Element> {
      if (!document.createTreeWalker) { yield* root.querySelectorAll(selector);

 return }

      observe(root)
      scan.roots.push({root, url: (root.nodeType === 9 ? root as Document : root.ownerDocument!).URL})
      const walker = document.createTreeWalker(root, 1)
      let node = walker.nextNode() as Element | null

      while (node) {
        yield node

        if (isEligible(node) && (!visibleOnly || visible(node))) {
          const shadow = shadowRootFor(node)

          if (shadow) { yield* walk(shadow) }

          if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') {
            let child: Document | null = null

            try { child = (node as HTMLIFrameElement).contentDocument } catch { /* inaccessible */ }

            if (child) { yield* walk(child) }
            else { scan.frames.push({ref: refFor(node), reason: 'inaccessible'}) }
          }

          node = walker.nextNode() as Element | null
        } else {
          let next = walker.nextSibling()

          while (!next && walker.parentNode()) { next = walker.nextSibling() }
          node = next as Element | null
        }
      }
    }

    // Validate even when a document has no elements; do not echo invalid selector text.
    if (document.documentElement?.matches) { document.documentElement.matches(selector) }
    else { document.querySelectorAll(selector) }

    scan.iterator = walk(document)

    return scan
  }

  const ownOverlay = (node: Node): boolean => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement

    return Boolean(element?.closest('[data-hermes-chrome-control="true"]'))
  }

  const changed = (records: MutationRecord[]): boolean => records.some(record => {
    if (ownOverlay(record.target)) { return false }

    if (record.type === 'childList') {
      const nodes = [...record.addedNodes, ...record.removedNodes]

      if (nodes.length && nodes.every(ownOverlay)) { return false }
    }

    return true
  })

  const Observer = document.defaultView?.MutationObserver
  const observer = Observer ? new Observer(records => { if (changed(records)) { revision++ } }) : undefined
  observer?.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  const maximum = Math.max(1, Math.min(MAX_ELEMENTS, options.maxElements ?? MAX_ELEMENTS))

  const refFor = (element: Element): string => {
    const existing = refs.get(element)

    if (existing !== undefined) { return existing }
    const owner = element.ownerDocument ?? document

    if (!documents.has(owner)) { documents.set(owner, nextDocument++) }
    const ref = `h-${instance}-d${documents.get(owner)}-e${nextRef++}`
    refs.set(element, ref)
    elementsByRef.set(ref, element)

    return ref
  }

  const serialize = (element: Element, format: SnapshotFormat): SafePageElement => {
    const sensitive = isSensitive(element)

    const result: SafePageElement = {
      boundingBox: boundingBox(element),
      ref: refFor(element)
    }

    if (!sensitive && format !== 'accessibility') {
      result.tag = element.tagName.toLowerCase()
      const text = redactText(safeText(element, actionable(element)))

      if (text.length > 0) { result.text = text }
    }

    if (format !== 'dom') {
      const role = inferRole(element)
      const name = sensitive ? undefined : accessibleName(element)

      if (role !== undefined) { result.role = role }

      if (name !== undefined) { result.name = name }
    }

    const rawValue = sensitive ? undefined : (element as Element & { value?: unknown }).value

    if (sensitive) {
      result.sensitive = true
      result.value = '[redacted]'
    } else if (typeof rawValue === 'string' && rawValue.length > 0) {
      result.value = redactText(rawValue)
    }

    const disabled = booleanState(element, 'disabled')
    const checked = booleanState(element, 'checked')
    const selected = booleanState(element, 'selected')
    const expanded = attribute(element, 'aria-expanded')

    if (disabled !== undefined) { result.disabled = disabled }

    if (checked !== undefined) { result.checked = checked }

    if (selected !== undefined) { result.selected = selected }

    if (expanded === 'true' || expanded === 'false') { result.expanded = expanded === 'true' }

    return result
  }

  const inspect = (input: InspectionOptions, format: SnapshotFormat, defaultLimit: number): PageInspectionResult => {
    if (changed(observer?.takeRecords() ?? [])) { revision++ }
    const selector = input.selector ?? '*'
    const limit = clampLimit(input.limit ?? defaultLimit, maximum)
    const maxChars = Math.max(1, Math.min(240, input.maxChars ?? 100))
    const key = JSON.stringify([selector, format, limit, maxChars, input.fields, input.visibleOnly ?? true])
    const continuation = input.cursor ? cursors.get(input.cursor) : undefined

    if (input.cursor && (!continuation || continuation.key !== key || continuation.revision !== revision)) {
      throw new PageInspectorError('INVALID_SELECTOR', 'The inspection cursor is stale or does not match these options.')
    }

    let scan: Scan

    try { scan = continuation?.scan ?? newScan(selector, input.visibleOnly !== false) } catch {
      throw new PageInspectorError('INVALID_SELECTOR', 'The provided selector is invalid.')
    }

    if (scan.roots.some(({root, url}) => {
      const owner = root.nodeType === 9 ? root as Document : root.ownerDocument!

      return owner.URL !== url || (owner.documentElement && !active(owner.documentElement)) ||
        (root.nodeType !== 9 && !(root as ShadowRoot).host.isConnected)
    })) { throw new PageInspectorError('INVALID_SELECTOR', 'The inspection cursor document has changed.') }

    if (input.cursor) { cursors.delete(input.cursor) }
    const matched: Element[] = []

    if (scan.pending.length < limit && !scan.done) {
      for (let visited = 0; visited < 1000; visited++) {
        const next = scan.iterator.next()

        if (next.done) { scan.done = true;

 break }

        const node = next.value

        if (!node.matches || node.matches(selector)) { matched.push(node) }
      }
    }

    const eligible = matched.filter(element => isEligible(element) && (input.visibleOnly === false || visible(element)))
      .filter(element => !element.childNodes || actionable(element) || inferRole(element) || safeText(element).trim())
      .filter(element => {
        if (input.selector || actionable(element)) { return true }

        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (actionable(parent)) { return false }
        }

        return true
      })
      .sort((a, b) => Number(actionable(b)) - Number(actionable(a)))

    scan.pending.push(...eligible)

    const elements = scan.pending.splice(0, limit).map(element => {
      const item = serialize(element, format)

      for (const field of ['name', 'text', 'value', 'role', 'tag'] as const) {
        if (item[field]) { item[field] = bound(item[field]!, maxChars) }
      }

      if (input.fields) {
        const fields = new Set(input.fields.flatMap(field => field === 'box' ? ['boundingBox'] :
          field === 'state' ? ['checked', 'disabled', 'expanded', 'selected', 'sensitive'] : [field]))

        for (const field of Object.keys(item)) {
          if (!fields.has(field)) { delete (item as unknown as Record<string, unknown>)[field] }
        }
      }

      return item
    })

    let cursor: string | undefined

    if (scan.pending.length || !scan.done) {
      cursor = `c-${Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(36)).join('-')}`

      if (cursors.size >= 64) { cursors.delete(cursors.keys().next().value!) }
      cursors.set(cursor, { key, revision, scan })
    }

    return {
      ...(cursor ? { nextCursor: cursor } : {}),
      ...(scan.frames.length ? { inaccessibleFrames: scan.frames.splice(0, 1000) } : {}),
      count: elements.length,
      elements,
      format,
      truncated: cursor !== undefined,
      version: 1
    }
  }

  return {
    dispose: () => { observer?.disconnect(); cursors.clear(); elementsByRef.clear() },
    locate(target) {
      const { element, ref, sensitive } = this.resolve(target)
      const steps: Array<{ kind: string, selector: string }> = []

      const path = (node: Element): string => {
        const parts: string[] = []

        for (let current: Element | null = node; current; current = current.parentElement) {
          const siblings = Array.from(current.parentNode?.children ?? []).filter(sibling => sibling.tagName === current!.tagName)
          parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`)
        }

        return parts.join(' > ')
      }

      let current = element
      let kind = 'element'

      while (true) {
        steps.unshift({ kind, selector: path(current) })
        const root = current.getRootNode()

        if ('host' in root) { current = (root as ShadowRoot).host; kind = 'shadow';

 continue }

        const frame = current.ownerDocument.defaultView?.frameElement

        if (frame) { current = frame; kind = 'frame';

 continue }

        break
      }

      return { ref, sensitive, editable: ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || attribute(element, 'contenteditable') === 'true',
        box: boundingBox(element), documentId: ref.split('-e')[0]!, locator: { steps } }
    },
    resolve(target: string): { element: Element, ref: string, sensitive: boolean } {
      const referenced = elementsByRef.get(target)

      if (referenced !== undefined) {
        if (!active(referenced)) { throw new PageInspectorError('ELEMENT_NOT_FOUND', 'The element ref is stale; inspect the page again.') }

        return { element: referenced, ref: target, sensitive: isSensitive(referenced) }
      }

      if (target.startsWith('h-')) { throw new PageInspectorError('ELEMENT_NOT_FOUND', 'The element ref is stale; inspect the page again.') }
      let element: Element | null

      try {
        element = collect(target, true).matched.find(isEligible) ?? null
      } catch {
        throw new PageInspectorError('INVALID_SELECTOR', 'The provided element target is invalid.')
      }

      if (element === null || !isEligible(element)) {
        throw new PageInspectorError('ELEMENT_NOT_FOUND', 'The requested element was not found.')
      }

      return { element, ref: refFor(element), sensitive: isSensitive(element) }
    },
    query: input => inspect(input, 'both', 20),
    snapshot: input => inspect(input, input.format, 60)
  }
}
