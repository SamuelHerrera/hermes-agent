import { expect, test } from './test'
import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'

let fixture: MockBackendFixture

test.beforeEach(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterEach(async () => {
  await fixture?.cleanup()
})

test('Settings is a reusable tab with independent navigation and close behavior', async ({}, testInfo) => {
  const { page } = fixture
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const shortcut = process.platform === 'darwin' ? 'Meta+,' : 'Control+,'
  const chatUrl = page.url()
  const settingsTab = page.getByRole('tab', { name: /Settings/ })
  const settings = page.locator('[data-settings-surface]')
  const composer = page.locator('[contenteditable="true"]:visible').first()
  await composer.fill('Keep this draft')

  await page.keyboard.press(shortcut)
  await expect(settingsTab).toBeVisible()
  await expect(settings).toBeVisible()
  await expect(page.locator('[data-overlay-surface]')).toHaveCount(0)
  await expect.poll(() => page.url()).toBe(chatUrl)
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
  await expect.poll(() => page.url()).toBe(chatUrl)
  await page.screenshot({ path: testInfo.outputPath('settings-wide.png'), fullPage: true })

  // Escape must not dismiss the tab or register a global overlay listener.
  await page.keyboard.press('Escape')
  await expect(settings).toBeVisible()
  await page.keyboard.press(shortcut)
  await expect(settingsTab).toHaveCount(1)
  await expect(settings).toBeVisible()

  await page.getByRole('tab', { name: /Keep this draft/ }).click()
  await expect(composer).toHaveText('Keep this draft')
  await settingsTab.click()
  await expect(settings).toBeVisible()

  await settingsTab.getByRole('button', { name: /close/i }).click()
  await expect(settingsTab).toHaveCount(0)
  await expect(settings).toHaveCount(0)
  await expect.poll(() => page.url()).toBe(chatUrl)
  await page.keyboard.press(shortcut)
  await expect(settingsTab).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(() =>
        new URLSearchParams(
          JSON.parse(localStorage.getItem('hermes.desktop.settingsTabRoute.v1') ?? '""').split('?')[1]
        ).get('tab')
      )
    )
    .toBe('config:appearance')
  await page.reload()
  await waitForAppReady(fixture)
  await expect(settingsTab).toHaveCount(1)
  await settingsTab.click()
  await expect(settings).toBeVisible()
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 800))
  await page.screenshot({ path: testInfo.outputPath('settings-narrow.png'), fullPage: true })
  expect(errors).toEqual([])
})
