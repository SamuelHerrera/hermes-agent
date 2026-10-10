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

test('browser scale is usable, fills the viewport and survives reload on desktop and mobile', async ({
  page
}, testInfo) => {
  await page.goto(`${backend.baseUrl}/desktop/`)
  const chooseLater = page.getByRole('button', { name: "I'll choose a provider later" })
  await expect(chooseLater).toBeVisible({ timeout: 30_000 })
  await chooseLater.click()
  await expect(chooseLater).not.toBeVisible()
  const menu = page.getByRole('button', { name: 'More app actions', exact: true })
  await expect(menu).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => typeof (window as Window & { hermesDesktop?: unknown }).hermesDesktop)).toBe(
    'undefined'
  )
  await menu.click()
  const scale = page.getByRole('group', { name: 'UI Scale', exact: true })
  await expect(
    page.getByRole('toolbar', { name: 'More controls' }).getByRole('group', { name: 'UI Scale' })
  ).toBeVisible()
  await expect(scale).not.toContainText('UI Scale')
  const reset = scale.getByRole('menuitem', { name: 'Reset UI scale to 90%' })
  await expect(reset).toHaveText('100%')
  await scale.getByRole('menuitem', { name: 'Increase UI scale' }).click()
  await expect(reset).toHaveText('110%')
  await scale.getByRole('menuitem', { name: 'Increase UI scale' }).click()
  await expect(reset).toHaveText('125%')
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe('1.25')
  await page.screenshot({ path: testInfo.outputPath('browser-scale-125.png') })
  await page.keyboard.press('Escape')
  const assertViewport = async () => {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const shell = document.querySelector('[style*="--titlebar-height"]')!.getBoundingClientRect()
          return Math.abs(shell.width - innerWidth) < 2 && Math.abs(shell.height - innerHeight) < 2
        })
      )
      .toBe(true)
  }
  await assertViewport()
  await page.reload()
  await menu.click()
  await expect(reset).toHaveText('125%')
  await scale.getByRole('menuitem', { name: 'Decrease UI scale' }).click()
  await expect(reset).toHaveText('110%')
  await reset.click()
  await expect(reset).toHaveText('90%')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await assertViewport()
  await menu.click()
  await expect(reset).toHaveText('90%')
  await scale.getByRole('menuitem', { name: 'Decrease UI scale' }).click()
  await expect(reset).toHaveText('75%')
  await page.screenshot({ path: testInfo.outputPath('browser-scale-mobile.png') })
})

for (const device of [
  { name: 'desktop', width: 1280, touch: false, enlarged: false },
  { name: 'mobile', width: 390, touch: true, enlarged: true },
  { name: 'touch laptop', width: 1280, touch: true, enlarged: true }
]) {
  test.describe(device.name, () => {
    test.use({ viewport: { width: device.width, height: 844 }, hasTouch: device.touch })

    test('uses an inline scale toolbar and ordered, device-sized header controls', async ({ page }, testInfo) => {
      await page.goto(`${backend.baseUrl}/desktop/`)
      const chooseLater = page.getByRole('button', { name: "I'll choose a provider later" })
      await expect(chooseLater).toBeVisible({ timeout: 30_000 })
      await chooseLater.click()
      const appControls = page.locator('[data-app-toolbar]')
      const buttons = appControls.getByRole('button')
      await expect(buttons.nth(0)).toHaveAttribute('aria-label', 'More app actions')
      await expect(buttons.nth(1)).toHaveAttribute('aria-label', /sidebar/i)
      const more = buttons.nth(0)
      expect((await more.boundingBox())!.width).toBe(device.enlarged ? 32 : 24)
      expect((await more.locator('svg').boundingBox())!.width).toBeCloseTo(device.enlarged ? 20 : 14)
      if (device.width < 768) {
        const app = (await appControls.boundingBox())!
        const workspace = (await page.locator('.app-header-right').boundingBox())!
        expect(workspace.y).toBeGreaterThanOrEqual(app.y + app.height)
      }
      await more.click()
      const toolbar = page.getByRole('toolbar', { name: 'More controls' })
      const scale = toolbar.getByRole('group', { name: 'UI Scale', exact: true })
      await expect(scale).toBeVisible()
      await expect(scale).not.toContainText('UI Scale')
      expect(
        await toolbar.evaluate(element => {
          const centers = [...element.querySelectorAll('button')].map(button => {
            const r = button.getBoundingClientRect()
            return r.y + r.height / 2
          })
          return Math.max(...centers) - Math.min(...centers)
        })
      ).toBeLessThan(2)
      await scale.getByRole('menuitem', { name: 'Increase UI scale' }).click()
      await expect(scale.getByRole('menuitem', { name: 'Reset UI scale to 90%' })).toHaveText('110%')
      await page.screenshot({ path: testInfo.outputPath(`toolbar-${device.name.replaceAll(' ', '-')}.png`) })
    })
  })
}
