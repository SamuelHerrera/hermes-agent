export interface PreparedTarget {
  x: number
  y: number
  sensitive: boolean
  editable: boolean
  ref?: string
  fileInput?: boolean
  boundingBox: { x: number, y: number, width: number, height: number }
}

export class DebuggerError extends Error {
  constructor(public readonly code: string, message: string) { super(message) }
}

interface Dependencies {
  attach(tabId: number): Promise<void>
  detach(tabId: number): Promise<void>
  send(tabId: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  prepare(tabId: number, action: string, args: Record<string, unknown>): Promise<PreparedTarget>
  assertControllable(tabId: number): Promise<unknown>
  upload?(tabId: number, args: Record<string, unknown>, target: PreparedTarget): Promise<unknown>
  download?(args: Record<string, unknown>, check: () => void): Promise<unknown>
  frames?(tabId: number): Promise<unknown>
  indicate?(tabId: number, x: number, y: number): Promise<unknown>
}

export function createDebuggerService(deps: Dependencies) {
  const dialogs = new Map<number, { dialogId: string, type: string }>()

  const event = (id: number, method: string, params: Record<string, unknown>) => {
    if (method === 'Page.javascriptDialogOpening') { dialogs.set(id, { dialogId: crypto.randomUUID(), type: ['alert', 'confirm', 'prompt', 'beforeunload'].includes(String(params.type)) ? String(params.type) : 'unknown' }) }

    if (method === 'Page.javascriptDialogClosed') { dialogs.delete(id) }
  }

  const revoked = new Set<number>()
  const attached = new Set<number>()
  const queues = new Map<number, Promise<unknown>>()
  const generations = new Map<number, number>()
  const generation = (id: number) => generations.get(id) ?? 0

  const cancel = async (id: number) => {
    generations.set(id, generation(id) + 1)
    dialogs.delete(id)

    if (attached.delete(id)) { await deps.detach(id).catch(() => undefined) }
  }

  const run = (id: number, action: string, args: Record<string, unknown>): Promise<unknown> => {
    const stamp = generation(id)

    const check = () => {
      if (stamp !== generation(id)) { throw new DebuggerError('CANCELLED', 'The browser action was cancelled.') }
    }

    const work = async () => {
      check()

      if (revoked.has(id)) { throw new DebuggerError('DEBUGGER_REVOKED', 'Browser debugging was cancelled by the user. Reconnect the bridge explicitly.') }
      await deps.assertControllable(id)
      check()

      if (!attached.has(id)) {
        await deps.attach(id)
        attached.add(id)
        await deps.send(id, 'Page.enable', {})

        if (stamp !== generation(id)) { await cancel(id); check() }
      }

      const send = async (method: string, params: Record<string, unknown>) => {
        check()
        await deps.assertControllable(id)
        check()
        const result = await deps.send(id, method, params)
        check()

        return result
      }

      if (action === 'frames') { return deps.frames?.(id) ?? { frames: [] } }

      if (action.startsWith('dialog_')) {
        const dialog = dialogs.get(id)

        if (action === 'dialog_inspect') { return dialog ?? { observed: false } }

        if (!dialog || dialog.dialogId !== args.dialogId) { throw new DebuggerError('STALE_DIALOG', 'Inspect the current JS dialog before handling it.') }

        if (args.promptText !== undefined) { throw new DebuggerError('SENSITIVE_DIALOG', 'Prompt text cannot be safely classified; use the browser manually.') }
        await send('Page.handleJavaScriptDialog', { accept: action === 'dialog_accept' })
        dialogs.delete(id)

        return { handled: true }
      }

      if (action === 'download') {
        if (!deps.download) { throw new DebuggerError('DOWNLOAD_UNAVAILABLE', 'Browser downloads are unavailable.') }

        return deps.download(args, check)
      }

      if (action === 'screenshot') {
        const format = args.format ?? 'png'
        let clip: Record<string, unknown> | undefined

        if (args.target !== undefined) {
          const target = await deps.prepare(id, action, args)
          const metrics = await send('Page.getLayoutMetrics', {})
          const viewport = metrics.cssLayoutViewport as { pageX?: number, pageY?: number } | undefined
          clip = { ...target.boundingBox, x: target.boundingBox.x + (viewport?.pageX ?? 0), y: target.boundingBox.y + (viewport?.pageY ?? 0), scale: 1 }
        } else if (args.fullPage === true) {
          const metrics = await send('Page.getLayoutMetrics', {})
          clip = { ...(metrics.cssContentSize as object), scale: 1 }
        }

        if (clip && (Number(clip.width) * Number(clip.height) > 32_000_000 || Number(clip.width) <= 0 || Number(clip.height) <= 0)) {
          throw new DebuggerError('SCREENSHOT_TOO_LARGE', 'Screenshot exceeds the 32 megapixel bound.')
        }

        const result = await send('Page.captureScreenshot', { format, ...(args.quality === undefined ? {} : { quality: args.quality }), ...(clip ? { clip } : {}), captureBeyondViewport: !!clip, fromSurface: true })

        if (typeof result.data !== 'string' || result.data.length > 900_000) { throw new DebuggerError('SCREENSHOT_TOO_LARGE', 'Screenshot exceeds the transfer bound.') }

        return { format, tabId: id, bytes: Math.floor(result.data.length * 3 / 4), dataUrl: `data:image/${String(format)};base64,${result.data}` }
      }

      const key = async (name: string, modifiers: string[] = []) => {
        const mask = modifiers.reduce((n, m) => n | ({ alt: 1, ctrl: 2, meta: 4, shift: 8 }[m] ?? 0), 0)
        const codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, ' ': 32 }
        const code = codes[name] ?? (name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0)
        const params = { key: name, modifiers: mask, windowsVirtualKeyCode: code, ...(name.length === 1 && mask === 0 ? { text: name } : {}), ...(name === 'Enter' ? { text: '\r' } : {}) }
        await send('Input.dispatchKeyEvent', { ...params, type: 'keyDown' })
        await send('Input.dispatchKeyEvent', { key: name, modifiers: mask, windowsVirtualKeyCode: code, type: 'keyUp' })
      }

      const target = await deps.prepare(id, action, args)
      check()

      if (target.fileInput && action !== 'upload' && action !== 'screenshot') { throw new DebuggerError('NATIVE_DIALOG_BLOCKED', 'Use an explicit upload instead of opening a native file chooser.') }

      if (target.sensitive) { throw new DebuggerError('SENSITIVE_FIELD', 'Sensitive browser input is blocked.') }

      if (action === 'upload') {
        if (!deps.upload) { throw new DebuggerError('UPLOAD_UNAVAILABLE', 'Browser file transfer is unavailable.') }
        check()

        return deps.upload(id, args, target)
      }

      const mouse = async (type: string) => send('Input.dispatchMouseEvent', {
        type, x: target.x, y: target.y,
        ...(type === 'mouseMoved' ? {} : { button: args.button ?? 'left', clickCount: 1 })
      })

      if (action === 'key') {
        await key(String(args.key), args.modifiers as string[] | undefined)

        return { pressed: true, route: 'trusted' }
      }

      if (action === 'type' && !target.editable) { throw new DebuggerError('ELEMENT_NOT_EDITABLE', 'The target is not editable.') }
      await deps.indicate?.(id, target.x, target.y)
      await mouse('mouseMoved')

      if (action === 'click' || action === 'type') {
        await mouse('mousePressed')
        await mouse('mouseReleased')
      }

      if (action === 'type') {
        // Re-check the deep active element after focusing; never insert into a moved focus target.
        const focused = await deps.prepare(id, 'key', { ...args, target: undefined })

        if (focused.sensitive || !focused.editable) { throw new DebuggerError('SENSITIVE_FIELD', 'The focused input is not safe.') }
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', commands: ['selectAll'] })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a' })
        const beforeInsert = await deps.prepare(id, 'key', { ...args, target: undefined })

        if (beforeInsert.sensitive || !beforeInsert.editable) { throw new DebuggerError('SENSITIVE_FIELD', 'Focus changed to an unsafe input.') }
        await send('Input.insertText', { text: args.text })

        if (args.submit === true) { await key('Enter') }
      }

      if (action === 'scroll') { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: target.x, y: target.y, deltaX: args.deltaX ?? 0, deltaY: args.deltaY ?? 0 }) }

      if (action === 'drag') {
        const destination = await deps.prepare(id, action, { ...args, target: args.destination })

        if (destination.sensitive) { throw new DebuggerError('SENSITIVE_FIELD', 'Sensitive browser input is blocked.') }
        await mouse('mousePressed')

        for (let step = 1; step <= 12; step++) {
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1, button: 'left', x: target.x + (destination.x - target.x) * step / 12, y: target.y + (destination.y - target.y) * step / 12 })
        }

        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: destination.x, y: destination.y })
      }

      return { action, route: 'trusted', dispatched: true, ...(target.ref ? { ref: target.ref } : {}) }
    }

    // JS dialogs can block an in-flight input command; their capabilities must
    // be handled out of band, but retain the same generation check.
    if (action.startsWith('dialog_') && attached.has(id)) { return work() }
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(work)
    queues.set(id, next)
    void next.finally(() => { if (queues.get(id) === next) { queues.delete(id) } }).catch(() => undefined)

    return next
  }

  const operation = (id: number, task: () => Promise<unknown>): Promise<unknown> => {
    const stamp = generation(id)

    const next = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (stamp !== generation(id)) { throw new DebuggerError('CANCELLED', 'The browser operation was cancelled.') }
      await deps.assertControllable(id)

      if (stamp !== generation(id)) { throw new DebuggerError('CANCELLED', 'The browser operation was cancelled.') }

      return task()
    })

    queues.set(id, next)
    void next.finally(() => { if (queues.get(id) === next) { queues.delete(id) } }).catch(() => undefined)

    return next
  }

  return { run, cancel, event, operation, disconnect: async () => { await Promise.all([...new Set([...queues.keys(), ...attached])].map(cancel)) }, reconnect: () => revoked.clear(), detached: (id: number, reason?: string) => { attached.delete(id); dialogs.delete(id); generations.set(id, generation(id) + 1);

 if (reason === 'canceled_by_user') { revoked.add(id) } } }
}

export type DebuggerService = ReturnType<typeof createDebuggerService>
