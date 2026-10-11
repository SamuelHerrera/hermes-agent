import { expect, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer
let url: string

test.use({ channel: 'chrome', viewport: { width: 1280, height: 576 } })
test.beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture server port')
  url = `http://127.0.0.1:${address.port}/e2e/fixtures/tab-targets.html`
})
test.afterAll(async () => {
  await server?.close()
})

for (const touch of [true, false]) {
  test.describe(touch ? 'wide coarse pointer at 75%' : 'desktop mouse at 75%', () => {
    test.use({ hasTouch: touch })
    test('shared tab primitives preserve targets, scrolling and vertical close containment', async ({ page }) => {
      await page.goto(url)
      await expect(page.getByRole('button', { name: 'Shared text tab' })).toBeVisible()
      await page.evaluate(() => {
        document.documentElement.style.zoom = '0.75'
        document.documentElement.style.setProperty('--browser-ui-scale', '0.75')
      })
      for (const selector of [
        '[data-slot="text-tab"]',
        '[data-slot="tabs-trigger"]',
        '.pane-strip-tool',
        '[data-slot="pane-tab"]:not([data-vertical]) [data-slot="pane-tab-close"]'
      ]) {
        const boxes = await page.locator(selector).evaluateAll(elements =>
          elements.map(element => {
            const box = element.getBoundingClientRect()
            return { width: box.width, height: box.height }
          })
        )
        expect(boxes.length).toBeGreaterThan(0)
        for (const box of boxes) {
          if (touch) {
            expect(box.width).toBeGreaterThanOrEqual(44)
            expect(box.height).toBeGreaterThanOrEqual(44)
          } else {
            expect(box.height).toBeLessThan(44)
          }
        }
      }
      const rail = page.locator('[data-vertical]')
      const railBox = (await rail.boundingBox())!
      const close = (await rail.getByRole('button', { name: 'Close' }).boundingBox())!
      expect(close.x).toBeGreaterThanOrEqual(railBox.x)
      expect(close.x + close.width).toBeLessThanOrEqual(railBox.x + railBox.width)
      const scroller = page.locator('.pane-tab-strip [role="tablist"]')
      expect(await scroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      await scroller.evaluate(element => {
        element.scrollLeft = element.scrollWidth
      })
      await expect(page.getByRole('button', { name: 'Add tab' })).toBeInViewport()
      await page.getByRole('button', { name: 'Add tab' }).click()
      await expect(page.getByRole('button', { name: 'Four', exact: true })).toHaveCount(1)
    })
  })
}
