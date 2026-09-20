import { expect, test } from '@playwright/test'

import { type BrowserBackend, startBrowserBackend } from './browser-backend'

let backend: BrowserBackend

test.beforeAll(async () => {
  backend = await startBrowserBackend()
})

test.afterAll(async () => {
  await backend?.cleanup()
})

test('serves the shared Desktop renderer as a normal browser page', async ({ page }) => {
  await page.goto(`${backend.baseUrl}/desktop/`)
  await expect(page.locator('#root')).toBeAttached()
  await expect.poll(() => page.evaluate(() => document.body.textContent?.length ?? 0)).toBeGreaterThan(0)

  const bootstrap = await page.evaluate(() => (window as Window & {
    __HERMES_DESKTOP_BOOTSTRAP__?: unknown
  }).__HERMES_DESKTOP_BOOTSTRAP__)
  expect(bootstrap).toMatchObject({ authRequired: false, basePath: '', sessionToken: backend.token })
  expect(await page.evaluate(() => typeof (window as Window & { hermesDesktop?: unknown }).hermesDesktop)).toBe('undefined')
})

test('exposes authenticated backend capabilities to the browser host', async ({ request }) => {
  const response = await request.get(`${backend.baseUrl}/api/capabilities`, {
    headers: { 'X-Hermes-Session-Token': backend.token }
  })

  expect(response.ok()).toBe(true)
  expect(await response.json()).toMatchObject({
    version: 1,
    capabilities: {
      files: true,
      git: true,
      lifecycle: true,
      persistentTerminal: false
    }
  })
})
