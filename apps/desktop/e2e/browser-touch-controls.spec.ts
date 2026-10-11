import { expect, test } from '@playwright/test'
import type { Terminal } from '@xterm/xterm'

import { type BrowserBackend, startBrowserBackend } from './browser-backend'

let backend: BrowserBackend
interface TerminalWindow extends Window {
  Terminal?: typeof Terminal
  testTerminal?: Terminal
}
test.use({ channel: 'chrome', hasTouch: true, viewport: { width: 574, height: 844 } })
test.beforeAll(async () => {
  backend = await startBrowserBackend({ terminal: true })
})
test.afterAll(async () => {
  await backend?.cleanup()
})

test('touch long-press reorders header actions and persists without activating them', async ({ page }) => {
  await page.goto(`${backend.baseUrl}/desktop/`)
  await page.getByRole('button', { name: "I'll choose a provider later" }).click()
  const cdp = await page.context().newCDPSession(page)
  const from = (await page.locator('[data-header-action="sidebar"]').boundingBox())!
  const to = (await page.locator('[data-header-action="notifications"]').boundingBox())!
  const touch = (x: number, y: number) => [{ x, y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: touch(from.x + from.width / 2, from.y + from.height / 2)
  })
  await page.waitForTimeout(450)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: touch(to.x + to.width / 2, to.y + to.height / 2)
  })
  await page.waitForTimeout(100)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

  const ids = () =>
    page
      .locator('[data-header-action]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-header-action')))

  await expect.poll(ids).toEqual(expect.arrayContaining(['sidebar', 'notifications']))
  expect((await ids()).indexOf('sidebar')).toBeGreaterThan((await ids()).indexOf('notifications'))
  await expect(page.getByRole('button', { name: 'Hide sidebar', exact: true })).toHaveCount(1)
  const order = await ids()
  await page.reload()
  await expect.poll(ids).toEqual(order)
})

test('touch tab drag stays held and commits a split over the terminal body', async ({ page }, testInfo) => {
  await page.goto(`${backend.baseUrl}/desktop/`)
  await page.getByRole('button', { name: "I'll choose a provider later" }).click()
  await page.getByRole('button', { name: 'New terminal', exact: true }).click()
  await expect(page.locator('.xterm:visible').first()).toBeVisible()
  const tab = page.locator('[data-tree-tab^="terminal-instance:"]:visible').first()
  const group = tab.locator('xpath=ancestor::*[@data-tree-group]').first()
  const initialGroups = await page.locator('[data-tree-group]:visible').count()
  const source = (await tab.boundingBox())!
  const target = (await group.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const sx = source.x + 30
  const sy = source.y + source.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] })

  // Move down into the body: native scrolling must not cancel the held tab.
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: sx + ((target.x + target.width / 2 - sx) * i) / 12,
          y: sy + ((target.y + target.height - 20 - sy) * i) / 12,
          id: 1
        }
      ]
    })
    await page.waitForTimeout(20)
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => page.locator('[data-tree-group]:visible').count()).toBe(initialGroups + 1)
  await expect(page.locator('[data-tree-tab^="terminal-instance:"]:visible')).toHaveCount(1)
  await expect(page.locator('.xterm:visible').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('touch-terminal-split.png') })
})

test('mouse tab drag still commits a split', async ({ page }) => {
  await page.goto(`${backend.baseUrl}/desktop/`)
  await page.getByRole('button', { name: "I'll choose a provider later" }).click()
  await page.getByRole('button', { name: 'New terminal', exact: true }).click()
  await expect(page.locator('.xterm:visible').first()).toBeVisible()
  const tab = page.locator('[data-tree-tab^="terminal-instance:"]:visible').first()
  const source = (await tab.boundingBox())!
  const target = (await tab.locator('xpath=ancestor::*[@data-tree-group]').first().boundingBox())!
  const before = await page.locator('[data-tree-group]:visible').count()
  await page.mouse.move(source.x + 30, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height - 20, { steps: 20 })
  await page.mouse.up()
  await expect.poll(() => page.locator('[data-tree-group]:visible').count()).toBe(before + 1)
})

test('a real terminal scrolls scrollback with a trusted touch gesture', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as TerminalWindow
    let constructor: typeof Terminal | undefined
    Object.defineProperty(window, 'Terminal', {
      configurable: true,
      get: () => constructor,
      set: (value: typeof Terminal) => {
        constructor = value
        const open = value.prototype.open

        value.prototype.open = function (...args) {
          open.apply(this, args)
          target.testTerminal = this
        }
      }
    })
  })
  await page.goto(`${backend.baseUrl}/desktop/`)
  await page.getByRole('button', { name: "I'll choose a provider later" }).click()
  await page.getByRole('button', { name: 'New terminal', exact: true }).click()

  const input = page.locator('.xterm:visible .xterm-helper-textarea').first()
  await expect(input).toBeAttached({ timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as TerminalWindow).testTerminal))).toBe(true)
  // Write real engine output, not a mocked buffer or shell invocation.
  await page.evaluate(async () => {
    const terminal = (window as unknown as TerminalWindow).testTerminal!
    await new Promise<void>(resolve =>
      terminal.write(Array.from({ length: 200 }, (_, i) => `TOUCH_LINE_${i}\r\n`).join(''), resolve)
    )
    terminal.scrollToBottom()
  })
  const before = await page.evaluate(() => (window as unknown as TerminalWindow).testTerminal!.buffer.active.viewportY)
  expect(before).toBeGreaterThan(0)
  const screen = (await page.locator('.xterm:visible .xterm-screen').first().boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const x = screen.x + screen.width / 2
  const y = screen.y + Math.min(80, screen.height / 4)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })

  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i * 10, id: 1 }] })
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as TerminalWindow).testTerminal!.buffer.active.viewportY))
    .toBeLessThan(before)
})
