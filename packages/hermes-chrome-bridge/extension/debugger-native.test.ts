import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

import { createDebuggerService, type PreparedTarget } from './debugger-service.js'

it('executes trusted browser input end to end and rejects overlay/focus races', async () => {
  const source = (await build({ entryPoints: ['extension/debugger-target.ts'], bundle: true, write: false, format: 'iife', globalName: 'Targets' })).outputFiles[0]!.text
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.setContent('<input id="ordinary"><input id="password" type="password"><button id="button">Click</button>')
    await page.addScriptTag({ content: source })
    await page.evaluate(() => { (window as unknown as { trusted: boolean[] }).trusted = []; document.addEventListener('click', e => (window as unknown as { trusted: boolean[] }).trusted.push(e.isTrusted)) })
    const cdp = await page.context().newCDPSession(page)

    const service = createDebuggerService({
      attach: async () => undefined, detach: async () => cdp.detach(), assertControllable: async () => undefined,
      send: async (_id, method, params) => cdp.send(method as never, params as never) as Promise<Record<string, unknown>>,
      prepare: async (_id, action, args) => page.evaluate(({ action, target }) => {
        const api = (window as unknown as { Targets: { inspectTarget: (locator: unknown, action: string) => PreparedTarget } }).Targets

        return api.inspectTarget(target ? { steps: [{ kind: 'element', selector: target }] } : null, action)
      }, { action, target: args.target as string | undefined })
    })

    await service.run(1, 'click', { target: '#button' })
    expect(await page.evaluate(() => (window as unknown as { trusted: boolean[] }).trusted)).toEqual([true])
    await service.run(1, 'type', { target: '#ordinary', text: 'hello' })
    expect(await page.locator('#ordinary').inputValue()).toBe('hello')
    await expect(service.run(1, 'type', { target: '#password', text: 'blocked' })).rejects.toMatchObject({ code: 'SENSITIVE_FIELD' })
    await page.evaluate(() => document.querySelector('#ordinary')!.addEventListener('focus', () => (document.querySelector('#password') as HTMLInputElement).focus()))
    await page.locator('#button').focus()
    await expect(service.run(1, 'type', { target: '#ordinary', text: 'blocked' })).rejects.toThrow()
    expect(await page.locator('#password').inputValue()).toBe('')
    await page.evaluate(() => { const overlay = document.createElement('input'); overlay.type = 'password'; overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:999'; document.body.append(overlay) })
    await expect(service.run(1, 'click', { target: '#button' })).rejects.toThrow()
    await service.disconnect()
  } finally { await browser.close() }
})
