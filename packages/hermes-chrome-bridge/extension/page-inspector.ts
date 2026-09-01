export type SnapshotFormat = 'accessibility' | 'both' | 'dom'

export interface BoundingBox {
  height: number
  width: number
  x: number
  y: number
}

export interface SafePageElement {
  boundingBox: BoundingBox
  checked?: boolean
  disabled?: boolean
  expanded?: boolean
  name?: string
  ref: string
  role?: string
  selected?: boolean
  sensitive?: boolean
  tag?: string
  text?: string
  value?: string
}

export interface PageInspectionResult {
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

export interface PageInspector {
  resolve(target: string): { element: Element, ref: string, sensitive: boolean }
  query(options: { limit?: number, selector: string }): PageInspectionResult
  snapshot(options: { format: SnapshotFormat }): PageInspectionResult
}

const MAX_ELEMENTS = 500
const MAX_TEXT_LENGTH = 240
const EXCLUDED_TAGS = new Set(['HEAD', 'LINK', 'META', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE'])
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const CARD = /\b(?:\d[ -]*?){13,19}\b/gu
const ASSIGNED_SECRET = /\b(?:api[-_ ]?key|authorization|bearer|password|secret|token)\s*[:=]\s*[^\s,;]+/giu
const PREFIXED_TOKEN = /\b(?:gh[pousr]_|sk[-_](?:live|test)[-_]|eyJ)[A-Za-z0-9._~-]{8,}/gu

function clampLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) { return maximum }

  return Math.max(1, Math.min(maximum, Math.trunc(value)))
}

function bound(value: string): string {
  return value.length <= MAX_TEXT_LENGTH ? value : `${value.slice(0, MAX_TEXT_LENGTH - 1)}…`
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
  const autocomplete = attribute(element, 'autocomplete')?.toLowerCase()

  const identity = [
    attribute(element, 'id'),
    attribute(element, 'name'),
    attribute(element, 'aria-label'),
    attribute(element, 'placeholder')
  ].filter((value): value is string => value !== undefined).join(' ')

  return type === 'password' ||
    autocomplete === 'current-password' ||
    autocomplete === 'new-password' ||
    autocomplete === 'one-time-code' ||
    autocomplete === 'cc-number' ||
    autocomplete === 'cc-csc' ||
    /(?:password|passcode|one[-_ ]?time|2fa|otp|card|cvv|cvc|security code)/iu.test(identity)
}

function inferRole(element: Element): string | undefined {
  const explicit = attribute(element, 'role')

  if (explicit !== undefined && explicit.length > 0) { return explicit }

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
  const labels = (element as Element & { labels?: ArrayLike<Element> }).labels

  if (labels === undefined) { return undefined }

  const text = Array.from(labels)
    .map(label => label.textContent ?? '')
    .join(' ')

  return text.length === 0 ? undefined : text
}

function accessibleName(element: Element): string | undefined {
  const value = attribute(element, 'aria-label') ??
    labelledText(element) ??
    attribute(element, 'alt') ??
    attribute(element, 'title') ??
    attribute(element, 'placeholder') ??
    element.textContent ?? undefined

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

export function createPageInspector(
  document: Document,
  options: { maxElements?: number } = {}
): PageInspector {
  const refs = new WeakMap<Element, string>()
  const elementsByRef = new Map<string, Element>()
  let nextRef = 1
  const maximum = Math.max(1, Math.min(MAX_ELEMENTS, options.maxElements ?? MAX_ELEMENTS))

  const refFor = (element: Element): string => {
    const existing = refs.get(element)

    if (existing !== undefined) { return existing }
    const ref = `e${nextRef++}`
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

    if (format !== 'accessibility') {
      result.tag = element.tagName.toLowerCase()
      const text = redactText(element.textContent ?? '')

      if (text.length > 0) { result.text = text }
    }

    if (format !== 'dom') {
      const role = inferRole(element)
      const name = accessibleName(element)

      if (role !== undefined) { result.role = role }

      if (name !== undefined) { result.name = name }
    }

    const rawValue = (element as Element & { value?: unknown }).value

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

  const inspect = (selector: string, format: SnapshotFormat, limit: number): PageInspectionResult => {
    let matched: Element[]

    try {
      matched = Array.from(document.querySelectorAll(selector))
    } catch {
      throw new PageInspectorError('INVALID_SELECTOR', 'The provided selector is invalid.')
    }

    const eligible = matched.filter(element =>
      !EXCLUDED_TAGS.has(element.tagName) && attribute(element, 'aria-hidden') !== 'true'
    )

    const elements = eligible.slice(0, limit).map(element => serialize(element, format))

    return {
      count: elements.length,
      elements,
      format,
      truncated: eligible.length > elements.length,
      version: 1
    }
  }

  return {
    resolve(target: string): { element: Element, ref: string, sensitive: boolean } {
      const referenced = elementsByRef.get(target)

      if (referenced !== undefined) {
        return { element: referenced, ref: target, sensitive: isSensitive(referenced) }
      }

      let element: Element | null

      try {
        element = document.querySelector(target)
      } catch {
        throw new PageInspectorError('INVALID_SELECTOR', 'The provided element target is invalid.')
      }

      if (element === null || EXCLUDED_TAGS.has(element.tagName) || attribute(element, 'aria-hidden') === 'true') {
        throw new PageInspectorError('ELEMENT_NOT_FOUND', 'The requested element was not found.')
      }

      return { element, ref: refFor(element), sensitive: isSensitive(element) }
    },
    query: ({ limit, selector }) => inspect(selector, 'both', clampLimit(limit, maximum)),
    snapshot: ({ format }) => inspect('*', format, maximum)
  }
}
