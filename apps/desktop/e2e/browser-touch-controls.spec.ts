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

for (const percent of [75, 100, 125]) {
  test(`terminal overlay matches its slot and leaves tabs clickable at ${percent}% UI scale`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('hermes.browser.uiScale.v1', String(value)), percent)
    await page.goto(`${backend.baseUrl}/desktop/`)
    await page.getByRole('button', { name: "I'll choose a provider later" }).click()
    await page.getByRole('button', { name: 'New terminal', exact: true }).click()
    await expect(page.locator('.xterm:visible').first()).toBeVisible()

    const drift = () =>
      page.evaluate(() => {
        const host = [...document.querySelectorAll('[data-persistent-terminal]')].find(
          element => getComputedStyle(element).visibility === 'visible'
        )

        if (!host) {
          return Infinity
        }

        const id = host.getAttribute('data-persistent-terminal')
        const slot = document.querySelector(`[data-terminal-slot="${id}"]`)!.getBoundingClientRect()
        const overlay = host.getBoundingClientRect()

        return Math.max(...(['top', 'left', 'right', 'bottom'] as const).map(key => Math.abs(slot[key] - overlay[key])))
      })

    await expect.poll(drift).toBeLessThanOrEqual(1.1)
    // Exercise live scale updates as well as restored scaling.
    await page.getByRole('button', { name: 'More app actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Increase UI scale', exact: true }).click()
    // Modal menus hide the trigger from the accessibility tree. Dismiss by
    // clicking outside, rather than routing Escape through xterm's keyboard.
    await page.mouse.click(550, 800)
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect.poll(drift).toBeLessThanOrEqual(1.1)
    await page.locator('[data-tree-tab="workspace"]:visible').click()
    await expect(page.locator('[data-persistent-terminal]:visible')).toHaveCount(0)
    await page.locator('[data-tree-tab^="terminal-instance:"]:visible').first().click()
    await expect(page.locator('.xterm:visible').first()).toBeVisible()
    await expect.poll(drift).toBeLessThanOrEqual(1.1)
  })
}

test('swiping from the home profile button scrolls without opening its menu, while tapping opens it', async ({
  page
}) => {
  await page.goto(`${backend.baseUrl}/desktop/`)
  await page.getByRole('button', { name: "I'll choose a provider later" }).click()
  const button = page.getByRole('button', { name: 'Profiles', exact: true })
  const box = (await button.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })

  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 15, y, id: 1 }] })
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect.poll(() => page.locator('[data-app-toolbar]').evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await button.tap()
  await expect(page.getByRole('menu')).toBeVisible()
})

test('header actions keep their fixed order after mouse and long-press touch drags and reload', async ({ page }) => {
  await page.goto(`${backend.baseUrl}/desktop/`)
  await page.getByRole('button', { name: "I'll choose a provider later" }).click()
  const ids = () =>
    page
      .locator('[data-header-action]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-header-action')))
  const order = await ids()
  expect(order.slice(0, 2)).toEqual(['app-menu', 'sidebar'])
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

  await expect.poll(ids).toEqual(order)
  await page.setViewportSize({ width: 1280, height: 844 })
  const mouseFrom = (await page.locator('[data-header-action="sidebar"]').boundingBox())!
  const mouseTo = (await page.locator('[data-header-action="notifications"]').boundingBox())!
  await page.mouse.move(mouseFrom.x + mouseFrom.width / 2, mouseFrom.y + mouseFrom.height / 2)
  await page.mouse.down()
  await page.mouse.move(mouseTo.x + mouseTo.width / 2, mouseTo.y + mouseTo.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(ids).toEqual(order)
  expect(await page.evaluate(() => localStorage.getItem('hermes.global.headerActionOrder.v1'))).toBeNull()
  // Old saved drag orders must not change the fixed toolbar after upgrading.
  await page.evaluate(
    value => localStorage.setItem('hermes.global.headerActionOrder.v1', JSON.stringify(value)),
    [...order].reverse()
  )
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
  const paneId = await tab.getAttribute('data-tree-tab')
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
  await expect(page.locator(`[data-tree-tab="${paneId}"]:visible`)).toHaveCount(1)
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
