import { expect, test } from '@playwright/test'

import { type BrowserBackend, startBrowserBackend } from './browser-backend'

let backend: BrowserBackend

test.use({ channel: 'chrome' })
test.beforeAll(async () => {
  backend = await startBrowserBackend()
})
test.afterAll(async () => {
  await backend?.cleanup()
})

for (const device of [
  { name: 'Titan2 zoomed out', width: 574, touch: true, percent: 75 },
  { name: 'wide touch zoomed out', width: 1280, touch: true, percent: 75 },
  { name: 'touch default scale', width: 574, touch: true, percent: 100 },
  { name: 'desktop mouse', width: 1280, touch: false, percent: 100 }
]) {
  test.describe(device.name, () => {
    test.use({ viewport: { width: device.width, height: 576 }, hasTouch: device.touch })

    test('workspace and browser tabs have independent usable activation and close targets', async ({ page }) => {
      await page.addInitScript(
        value => localStorage.setItem('hermes.browser.uiScale.v1', String(value)),
        device.percent
      )
      await page.goto(`${backend.baseUrl}/desktop/`)
      await page.getByRole('button', { name: "I'll choose a provider later" }).click()
      await page.getByRole('button', { name: 'New browser tab', exact: true }).click()
      const browser = page.locator('[data-tree-tab^="preview-tile:url:browser"]:visible').first()
      await expect(browser).toBeVisible()
      const workspace = page.locator('[data-tree-tab="workspace"]:visible')
      const close = browser.getByRole('button', { name: 'Close', exact: true })
      const box = (await browser.boundingBox())!
      const closeBox = (await close.boundingBox())!
      const workspaceBox = (await workspace.boundingBox())!
      if (device.touch) {
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(workspaceBox.height).toBeGreaterThanOrEqual(44)
        expect(closeBox.height).toBeGreaterThanOrEqual(44)
        expect(closeBox.width).toBeGreaterThanOrEqual(44)
        // Closing must not consume the whole activation target of a short tab.
        expect(closeBox.x - box.x).toBeGreaterThanOrEqual(44)
        await workspace.tap()
        await expect(workspace).toHaveAttribute('aria-selected', 'true')
        await page.touchscreen.tap(box.x + 20, box.y + box.height / 2)
        await expect(browser).toHaveAttribute('aria-selected', 'true')
        await close.tap()
      } else {
        expect(box.height).toBe(28)
        expect(closeBox.height).toBe(16)
        await close.click()
      }
      await expect(browser).toHaveCount(0)
    })
  })
}
