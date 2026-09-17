import { describe, expect, it, vi } from 'vitest'

import { createDebuggerService } from './debugger-service.js'

function setup() {
  const send = vi.fn(async (_tab: number, method: string) => method === 'Page.captureScreenshot' ? { data: 'aGVybWVz' } : {})
  const attach = vi.fn(async () => undefined)
  const detach = vi.fn(async () => undefined)
  const prepare = vi.fn(async () => ({ x: 10, y: 20, sensitive: false, editable: true, boundingBox: { x: 0, y: 0, width: 20, height: 40 } }))
  const service = createDebuggerService({ attach, detach, send, prepare, assertControllable: async () => undefined })

  return { service, send, attach, detach, prepare }
}

describe('trusted debugger service', () => {
  it('returns from dialog-opening input so the next tool can handle the dialog', async () => {
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })

    const service = createDebuggerService({
      attach: async () => undefined, detach: async () => undefined, assertControllable: async () => undefined,
      prepare: async () => ({ x: 1, y: 1, sensitive: false, editable: false, boundingBox: { x: 0, y: 0, width: 2, height: 2 } }),
      send: async (_tab, method, params) => {
        if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
          service.event(1, 'Page.javascriptDialogOpening', { type: 'confirm' })
          await blocked
        }

        if (method === 'Page.handleJavaScriptDialog') { release() }

        return {}
      }
    })

    try {
      const action = service.run(1, 'click', {}).then(() => 'completed', error => error.code)
      expect(await Promise.race([action, new Promise(resolve => setTimeout(() => resolve('blocked'), 2000))])).toBe('DIALOG_OPEN')
      const dialog = await service.run(1, 'dialog_inspect', {}) as { dialogId: string }
      await service.run(1, 'dialog_accept', { dialogId: dialog.dialogId })
    } finally { release() }
  })
  it('releases pressed keys when a request is cancelled', async () => {
    let release!: () => void
    let entered!: () => void
    const pressed = new Promise<void>(resolve => { entered = resolve })
    const blocked = new Promise<void>(resolve => { release = resolve })

    const send = vi.fn(async (_tab: number, method: string, params: Record<string, unknown>) => {
      if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown') { entered(); await blocked }

      return {}
    })

    const service = createDebuggerService({ send, attach: async () => undefined, detach: async () => undefined,
      assertControllable: async () => undefined,
      prepare: async () => ({ x: 1, y: 1, sensitive: false, editable: true, boundingBox: { x: 0, y: 0, width: 2, height: 2 } }) })

    const action = service.run(1, 'key', { key: 'Shift' }).catch(error => error.code)
    await pressed
    await service.cancel(1)
    release()
    expect(await action).toBe('CANCELLED')
    expect(send).toHaveBeenCalledWith(1, 'Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp', key: 'Shift' }))
  })
  it('types through browser input and refuses sensitive fields', async () => {
    const { service, send, prepare } = setup()
    await service.run(2, 'type', { target: '#text', text: 'hello', submit: true })
    expect(send).toHaveBeenCalledWith(2, 'Input.insertText', { text: 'hello' })
    expect(send).toHaveBeenCalledWith(2, 'Input.dispatchKeyEvent', expect.objectContaining({ key: 'Enter', type: 'keyDown' }))
    prepare.mockResolvedValueOnce({ x: 1, y: 1, sensitive: true, editable: true, boundingBox: { x: 0, y: 0, width: 2, height: 2 } })
    send.mockClear()
    await expect(service.run(2, 'type', { target: '#password', text: 'secret' })).rejects.toMatchObject({ code: 'SENSITIVE_FIELD' })
    expect(send).not.toHaveBeenCalled()
  })
  it('queues gestures per tab and cancels queued and in-flight work on disconnect', async () => {
    const { service, prepare, send } = setup()
    let release!: () => void
    prepare.mockImplementationOnce(async () => { await new Promise<void>(r => { release = r });

 return { x: 1, y: 1, sensitive: false, editable: false, boundingBox: { x: 0, y: 0, width: 2, height: 2 } } })
    const first = service.run(1, 'click', {})
    const second = service.run(1, 'click', {})
    const results = Promise.allSettled([first, second])
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await service.disconnect()
    release()
    expect((await results).every(r => r.status === 'rejected')).toBe(true)
    expect(send).not.toHaveBeenCalledWith(1, 'Input.dispatchMouseEvent', expect.anything())
  })
  it('captures via CDP without pointer activity and performs drag and wheel gestures', async () => {
    const { service, send } = setup()
    await expect(service.run(2, 'screenshot', { format: 'png' })).resolves.toMatchObject({ dataUrl: 'data:image/png;base64,aGVybWVz' })
    expect(send).not.toHaveBeenCalledWith(2, 'Input.dispatchMouseEvent', expect.anything())
    await service.run(2, 'scroll', { deltaY: 40 })
    expect(send).toHaveBeenCalledWith(2, 'Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseWheel', deltaY: 40 }))
    await service.run(2, 'drag', { target: '#a', destination: '#b' })
    expect(send).toHaveBeenCalledWith(2, 'Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseMoved', buttons: 1 }))
  })
  it('does not reattach after the user cancels Chrome debugging', async () => {
    const { service, attach } = setup()
    await service.run(2, 'hover', { target: '#a' })
    service.detached(2, 'canceled_by_user')
    await expect(service.run(2, 'hover', { target: '#a' })).rejects.toMatchObject({ code: 'DEBUGGER_REVOKED' })
    expect(attach).toHaveBeenCalledTimes(1)
    service.reconnect()
    await service.run(2, 'hover', { target: '#a' })
    expect(attach).toHaveBeenCalledTimes(2)
  })
  it('serializes lifecycle mutations and cancels them with the same generation', async () => {
    const { service } = setup()
    const action = vi.fn(async () => ({ navigated: true }))
    const first = service.operation(2, action)
    await service.cancel(2)
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(action).not.toHaveBeenCalled()
  })
  it('binds JS dialog capabilities and never exposes dialog text', async () => {
    const { service, send } = setup()
    await service.run(2, 'dialog_inspect', {})
    service.event(2, 'Page.javascriptDialogOpening', { type: 'prompt', message: 'password=secret' })
    const state = await service.run(2, 'dialog_inspect', {}) as { dialogId: string }
    expect(JSON.stringify(state)).not.toContain('secret')
    await expect(service.run(2, 'dialog_accept', { dialogId: 'stale' })).rejects.toMatchObject({ code: 'STALE_DIALOG' })
    await service.run(2, 'dialog_dismiss', { dialogId: state.dialogId })
    expect(send).toHaveBeenCalledWith(2, 'Page.handleJavaScriptDialog', { accept: false })
  })
  it('attaches once and emits browser mouse events rather than DOM events', async () => {
    const { service, send, attach } = setup()
    await service.run(2, 'click', { target: '#button' })
    await service.run(2, 'hover', { target: '#button' })
    expect(attach).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(2, 'Input.dispatchMouseEvent', expect.objectContaining({ type: 'mousePressed', x: 10, y: 20 }))
    expect(send).toHaveBeenCalledWith(2, 'Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseReleased' }))
  })
})
