import { expect, test } from '@playwright/test'

import { type BrowserBackend, startBrowserBackend } from './browser-backend'

let backend: BrowserBackend

test.use({ channel: 'chrome' })
test.beforeEach(async () => { backend = await startBrowserBackend({ browserProxySetup: true }) })
test.afterEach(async () => { await backend?.cleanup() })

for (const viewport of [{ width: 1280, height: 800 }, { width: 574, height: 576 }]) {
  test.describe(`PWA setup ${viewport.width}px`, () => {
    test.use({ viewport })
    test('saving setup starts the real helper and survives reload', async ({ page, request }, testInfo) => {
      await page.goto(`${backend.baseUrl}/desktop/`)
      await page.getByRole('button', { name: "I'll choose a provider later" }).click()
      const dialog = page.getByRole('dialog', { name: 'Set up PWA browsing' })
      await expect(dialog).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('pwa-browser-setup.png') })
      await page.getByLabel('Separate HTTPS proxy origin').fill('https://browser.example.net/')
      const saved = page.waitForResponse(response => response.url().includes('/api/config') && response.request().method() === 'PUT')
      await page.getByRole('button', { name: 'Save and start' }).click()
      const response = await saved
      expect(response.status()).toBe(200)
      const status = await response.json()
      expect(status.browser_proxy.running).toBe(true)
      expect(status.browser_proxy.port).toBeGreaterThan(0)
      await expect(dialog).toBeHidden()
      const config = await request.get(`${backend.baseUrl}/api/config`, { headers: { 'X-Hermes-Session-Token': backend.token } })
      const value = await config.json()
      expect(value.desktop.browser_proxy_origin).toBe('https://browser.example.net')
      expect(value.desktop.browser_proxy_setup_complete).toBe(true)
      const unauthenticated = await request.post(`http://127.0.0.1:${status.browser_proxy.port}/bootstrap`, {
        headers: { Host: 'browser.example.net', Origin: 'https://browser.example.net' },
        data: { ticket: 'missing' }
      })
      expect(unauthenticated.status()).toBe(401)
      await Promise.all([
        page.waitForResponse(r => r.url().includes('/api/config') && r.request().method() === 'GET'),
        page.reload()
      ])
      await expect(page.getByRole('button', { name: 'New browser tab', exact: true })).toBeVisible()
      await expect(dialog).toBeHidden()
    })
  })
}

test('deferring setup persists without activating a proxy', async ({ page, request }) => {
  await page.goto(`${backend.baseUrl}/desktop/`)
  await page.getByRole('button', { name: "I'll choose a provider later" }).click()
  await page.getByRole('button', { name: 'Set up later' }).click()
  await expect(page.getByRole('dialog', { name: 'Set up PWA browsing' })).toBeHidden()
  const response = await request.get(`${backend.baseUrl}/api/config`, { headers: { 'X-Hermes-Session-Token': backend.token } })
  const value = await response.json()
  expect(value.desktop.browser_proxy_setup_complete).toBe(true)
  expect(value.desktop.browser_proxy_origin).toBeFalsy()
})
