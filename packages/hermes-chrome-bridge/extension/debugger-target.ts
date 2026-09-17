import { DebuggerError, type PreparedTarget } from './debugger-service.js'
import { CONTENT_INSTALLATION_VERSION } from './inspection-installation.js'
import { isControllableHttpUrl } from './url-policy.js'

export async function sendFrameMessage(tabId: number, message: unknown, frameId = 0): Promise<unknown> {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId })

  if (!frame || !isControllableHttpUrl(frame.url)) { throw new DebuggerError('TARGET_URL_BLOCKED', 'The frame URL is not permitted.') }
  let pong: { installationVersion?: string } | undefined

  try { pong = await chrome.tabs.sendMessage(tabId, { type: 'hermes.bridge.ping', version: 2 }, { frameId }) } catch { /* old or absent content listener */ }

  if (pong?.installationVersion !== CONTENT_INSTALLATION_VERSION) {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content-script.js'] })
    pong = await chrome.tabs.sendMessage(tabId, { type: 'hermes.bridge.ping', version: 2 }, { frameId })

    if (pong?.installationVersion !== CONTENT_INSTALLATION_VERSION) { throw new DebuggerError('CONTENT_VERSION_MISMATCH', 'The frame content bridge could not be refreshed.') }
  }

  return chrome.tabs.sendMessage(tabId, { ...(message as object), version: 2 }, { frameId })
}

interface Locator { steps: Array<{ kind: string, selector: string }> }
interface Located { locator: Locator, ref: string, sensitive: boolean, documentId: string }

const frameSessions = new Map<number, Map<string, { parent?: string }>>()

export function trackFrameSession(tabId: number, parent: string | undefined, method: string, params: Record<string, unknown>): void {
  if (method === 'Target.attachedToTarget' && (params.targetInfo as { type?: string } | undefined)?.type === 'iframe' && typeof params.sessionId === 'string') {
    const sessions = frameSessions.get(tabId) ?? new Map<string, { parent?: string }>()
    frameSessions.set(tabId, sessions)
    sessions.set(params.sessionId, { parent })
    void chrome.debugger.sendCommand({ tabId, sessionId: params.sessionId }, 'Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false }).catch(() => undefined)
  }

  if (method === 'Target.detachedFromTarget' && typeof params.sessionId === 'string') { frameSessions.get(tabId)?.delete(params.sessionId) }
}

export function clearFrameSessions(tabId: number): void { frameSessions.delete(tabId) }

// Serializable isolated-world function. Never reads input values or page secrets.
export function inspectTarget(locator: Locator | null, action: string, payloads?: Array<{ name: string, data: string }> | null, allowedUrls?: string[] | null, point?: { x: number, y: number } | null) {
  const shadow = (node: Element): ShadowRoot | null => node.shadowRoot ?? (typeof chrome !== 'undefined' ? chrome.dom?.openOrClosedShadowRoot(node as HTMLElement) : null) ?? null
  let root: Document | ShadowRoot = document
  let element: Element | null = null

  if (locator) {
    for (const step of locator.steps) {
      element = root.querySelector(step.selector)

      if (!element) { throw new Error('STALE_TARGET') }

      if (step.kind === 'shadow') {
        const child = shadow(element)

        if (!child) { throw new Error('SHADOW_ROOT_UNAVAILABLE') }
        root = child
      } else if (step.kind === 'frame') {
        const child: Document | null = (element as HTMLIFrameElement).contentDocument

        if (!child) { throw new Error('INACCESSIBLE_FRAME') }
        root = child
      }
    }
  } else if (action === 'key') {
    element = document.activeElement

    for (let depth = 0; depth < 32 && element; depth++) {
      const active = shadow(element)?.activeElement

      if (active) { element = active;

 continue }

      if (element.tagName === 'IFRAME') {
        const child: Document | null = (element as HTMLIFrameElement).contentDocument

        if (!child) { throw new Error('INACCESSIBLE_FRAME') }
        element = child.activeElement;

 continue
      }

      break
    }
  } else {
    const x = point?.x ?? innerWidth / 2, y = point?.y ?? innerHeight / 2
    element = document.elementFromPoint(x, y)

    for (let depth = 0; depth < 32 && element; depth++) {
      const hit = shadow(element)?.elementFromPoint(x, y)

      if (!hit || hit === element) { break }
      element = hit
    }
  }

  if (!element) { throw new Error('ELEMENT_NOT_FOUND') }

  if (element.tagName === 'IFRAME' && action !== 'screenshot') { throw new Error('FRAME_TARGET_REQUIRED') }

  // Unknown custom elements may hide a focused secret in a closed root: fail closed.
  if (element.tagName.includes('-') && !shadow(element) && (typeof chrome === 'undefined' || !chrome.dom?.openOrClosedShadowRoot)) { throw new Error('CLOSED_SHADOW_ROOT') }
  const control = element.closest('input,textarea,select,[contenteditable]') ?? element
  const a = (name: string) => control.getAttribute(name) ?? ''
  const labels = Array.from((control as HTMLInputElement).labels ?? []).map(label => label.textContent ?? '').join(' ')
  const referenced = a('aria-labelledby').split(/\s+/u).map(id => control.ownerDocument.getElementById(id)?.textContent ?? '').join(' ')
  const identity = [a('id'), a('name'), a('aria-label'), a('placeholder'), labels, referenced, control.closest('label')?.textContent ?? ''].join(' ')
  const sensitive = a('type').toLowerCase() === 'password' || /(?:current-password|new-password|one-time-code|username|cc-)/iu.test(a('autocomplete')) || /(?:api[-_ ]?(?:key|token)|access[-_ ]?token|auth(?:orization)?|bearer|client[-_ ]?secret|credential|password|passcode|secret|token|one[-_ ]?time|2fa|otp|card|cc[-_ ]?(?:csc|cvv|exp|number)|cvv|cvc|security[-_ ]?code|expiry|expiration)/iu.test(identity)
  const editable = ['INPUT', 'TEXTAREA'].includes(control.tagName) || (control as HTMLElement).isContentEditable === true

  if (allowedUrls && !allowedUrls.includes(element.ownerDocument.URL)) { throw new Error('TARGET_URL_CHANGED') }

  if (!point && action !== 'screenshot' && action !== 'inspect') { element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }) }
  const r = element.getBoundingClientRect()

  if (action !== 'screenshot' && action !== 'key' && action !== 'inspect') {
    const owner = element.getRootNode() as Document | ShadowRoot
    const hit = owner.elementFromPoint(point?.x ?? r.x + r.width / 2, point?.y ?? r.y + r.height / 2)

    if (!hit || (hit !== element && (!element.contains(hit) || hit.closest('input,textarea,select,[contenteditable]') !== null))) { throw new Error('TARGET_OCCLUDED') }
  }

  let x = r.x, y = r.y
  let view = element.ownerDocument.defaultView
  const urls: string[] = [element.ownerDocument.URL]

  while (view && view !== window) {
    const frame = view.frameElement

    if (!frame) { throw new Error('INACCESSIBLE_FRAME') }
    const box = frame.getBoundingClientRect()
    x += box.x + frame.clientLeft; y += box.y + frame.clientTop
    view = frame.ownerDocument.defaultView
    urls.push(frame.ownerDocument.URL)
  }

  const fileInput = control.tagName === 'INPUT' && a('type') === 'file'

  if (payloads) {
    if (sensitive || !fileInput) { throw new Error('SENSITIVE_OR_NOT_FILE_INPUT') }

    if (payloads.length > 1 && !(control as HTMLInputElement).multiple) { throw new Error('FILE_INPUT_NOT_MULTIPLE') }
    const transfer = new DataTransfer()

    for (const file of payloads) {
      const binary = atob(file.data)
      transfer.items.add(new File([Uint8Array.from(binary, c => c.charCodeAt(0))], file.name, { type: 'application/octet-stream' }))
    }

    ;(control as HTMLInputElement).files = transfer.files
    control.dispatchEvent(new Event('input', { bubbles: true }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
  }

  return { x: point ? point.x + x - r.x : x + r.width / 2, y: point ? point.y + y - r.y : y + r.height / 2, boundingBox: { x, y, width: r.width, height: r.height }, sensitive, editable, fileInput, urls }
}

export async function prepareChromeTarget(tabId: number, action: string, args: Record<string, unknown>): Promise<PreparedTarget> {
  const frameId = Number(args.frameId ?? 0)
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId })

  if (!frame || !isControllableHttpUrl(frame.url)) { throw new DebuggerError('TARGET_URL_BLOCKED', 'The frame URL is not permitted.') }
  let located: Located | undefined
  const point = typeof args.x === 'number' && typeof args.y === 'number' ? { x: args.x, y: args.y } : null

  if (typeof args.target === 'string') {
    const response = await sendFrameMessage(tabId, { type: 'hermes.bridge.resolve', version: 1, target: args.target }, frameId) as { type?: string, result?: Located, error?: { code?: string } }

    if (response?.type !== 'hermes.bridge.result' || !response.result?.locator) { throw new DebuggerError(response?.error?.code ?? 'TARGET_UNAVAILABLE', 'The target could not be resolved safely; take a fresh snapshot.') }
    located = response.result as Located

    if (located.sensitive && action !== 'screenshot') { throw new DebuggerError('SENSITIVE_FIELD', 'Sensitive input is blocked.') }
  }

  const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: inspectTarget, args: [located?.locator ?? null, action === 'key' ? 'key' : 'inspect', null, null, point] })
  let target = results[0]?.result

  if (!target || !target.urls.every(isControllableHttpUrl)) { throw new DebuggerError('TARGET_URL_BLOCKED', 'The frame URL is not permitted.') }

  if (action !== 'screenshot' && action !== 'key') {
    const checked = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: inspectTarget, args: [located?.locator ?? null, action, null, target.urls, point] })
    target = checked[0]?.result

    if (!target || !target.urls.every(isControllableHttpUrl)) { throw new DebuggerError('TARGET_URL_BLOCKED', 'The frame URL changed.') }
  }

  if (![target.x, target.y, target.boundingBox.width, target.boundingBox.height].every(Number.isFinite) || target.boundingBox.width <= 0 || target.boundingBox.height <= 0) { throw new DebuggerError('TARGET_NOT_VISIBLE', 'The target has no visible geometry.') }

  if (frameId !== 0) {
    // Bind Chrome's frame to CDP by a fresh random DOM marker, not a guessed URL.
    const marker = crypto.randomUUID()
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: (value: string) => document.documentElement.setAttribute('data-hermes-frame-probe', value), args: [marker] })

    try {
      await chrome.debugger.sendCommand({ tabId }, 'Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false })
      const sessions = frameSessions.get(tabId) ?? new Map<string, { parent?: string }>()
      const roots = new Map<string | undefined, string>()
      let cdpFrame: string | undefined
      let foundSession: string | undefined

      for (const sessionId of [undefined, ...sessions.keys()]) {
        const debuggee = { tabId, ...(sessionId ? { sessionId } : {}) }
        const tree = await chrome.debugger.sendCommand(debuggee, 'Page.getFrameTree') as { frameTree: { frame: { id: string }, childFrames?: unknown[] } }
        roots.set(sessionId, tree.frameTree.frame.id)
        const frames: string[] = []

        const collect = (node: typeof tree.frameTree): void => { frames.push(node.frame.id);

 for (const child of node.childFrames ?? []) { collect(child as typeof node) } }

        collect(tree.frameTree)

        for (const id of frames) {
          try {
            const world = await chrome.debugger.sendCommand(debuggee, 'Page.createIsolatedWorld', { frameId: id, worldName: 'hermes-frame-binding' }) as { executionContextId: number }
            const result = await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', { contextId: world.executionContextId, expression: `document.documentElement.getAttribute('data-hermes-frame-probe') === ${JSON.stringify(marker)}`, returnByValue: true }) as { result: { value?: boolean } }

            if (result.result.value) { cdpFrame = id; foundSession = sessionId;

 break }
          } catch { /* Cross-process frame worlds belong to their attached session. */ }
        }

        if (cdpFrame) { break }
      }

      if (!cdpFrame) { throw new DebuggerError('FRAME_UNAVAILABLE', 'The frame could not be bound to the debugger.') }
      let ownerSession = foundSession && roots.get(foundSession) === cdpFrame ? sessions.get(foundSession)?.parent : foundSession

      for (let depth = 0; depth < 16; depth++) {
        const debuggee = { tabId, ...(ownerSession ? { sessionId: ownerSession } : {}) }
        const owner = await chrome.debugger.sendCommand(debuggee, 'DOM.getFrameOwner', { frameId: cdpFrame }) as { backendNodeId: number }
        const box = await chrome.debugger.sendCommand(debuggee, 'DOM.getBoxModel', owner) as { model: { content: number[] } }
        const q = box.model.content

        if (Math.abs(q[1]! - q[3]!) > 0.5 || Math.abs(q[0]! - q[6]!) > 0.5) { throw new DebuggerError('FRAME_TRANSFORM_UNSUPPORTED', 'Rotated frame input is unsupported.') }
        target.x += q[0]!; target.y += q[1]!
        target.boundingBox.x += q[0]!; target.boundingBox.y += q[1]!

        if (!ownerSession) { break }
        const tree = await chrome.debugger.sendCommand(debuggee, 'Page.getFrameTree') as { frameTree: { frame: { id: string } } }
        cdpFrame = tree.frameTree.frame.id
        ownerSession = sessions.get(ownerSession)?.parent
      }
    } finally {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: () => document.documentElement.removeAttribute('data-hermes-frame-probe') }).catch(() => undefined)
    }
  }

  await chrome.tabs.sendMessage(tabId, { type: 'hermes.bridge.indicator', active: true, version: 1 }, { frameId }).catch(() => undefined)

  return { ...target, ...(located ? { ref: located.ref, locator: located.locator } : {}) }
}

export async function uploadChromeFiles(tabId: number, args: Record<string, unknown>, target: PreparedTarget) {
  const locator = (target as PreparedTarget & { locator?: Locator }).locator

  if (!locator || !target.fileInput || target.sensitive) { throw new DebuggerError('INVALID_UPLOAD_TARGET', 'A non-sensitive file input is required.') }
  const files = args.filePayloads as Array<{ name: string, data: string }>

  if (files.reduce((n, f) => n + f.data.length, 0) > 350_000) { throw new DebuggerError('UPLOAD_TOO_LARGE', 'Upload transfer exceeds 256 KiB.') }
  const result = await chrome.scripting.executeScript({ target: { tabId, frameIds: [Number(args.frameId ?? 0)] }, func: inspectTarget, args: [locator, 'upload', files, (target as PreparedTarget & { urls: string[] }).urls] })

  if (!result[0]?.result?.fileInput) { throw new DebuggerError('UPLOAD_FAILED', 'Files were not attached.') }

  return { uploaded: files.length, route: 'file-transfer', eventsTrusted: false }
}
