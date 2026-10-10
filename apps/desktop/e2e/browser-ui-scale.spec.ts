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
  expect(await page.evaluate(() => typeof (window as Window & { hermesDesktop?: unknown }).hermesDesktop)).toBe('undefined')
  await menu.click()
  const scale = page.getByRole('group', { name: 'UI Scale', exact: true })
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
