import { expect, test } from '@playwright/test'

import { type BrowserBackend, startBrowserBackend } from './browser-backend'

let backend: BrowserBackend

test.beforeAll(async () => {
  backend = await startBrowserBackend()
})

test.afterAll(async () => {
  await backend?.cleanup()
})

test('rejects protected REST data without the session token', async ({ request }) => {
  const missing = await request.get(`${backend.baseUrl}/api/capabilities`)
  const invalid = await request.get(`${backend.baseUrl}/api/capabilities`, {
    headers: { 'X-Hermes-Session-Token': 'invalid' }
  })

  expect(missing.status()).toBe(401)
  expect(invalid.status()).toBe(401)
})

test('browser mode exposes no native bridge and traversal remains contained', async ({ page, request }) => {
  await page.goto(`${backend.baseUrl}/desktop/`)
  expect(await page.evaluate(() => typeof (window as Window & { hermesDesktop?: unknown }).hermesDesktop)).toBe('undefined')

  const traversal = await request.get(`${backend.baseUrl}/desktop/%2e%2e/%2e%2e/etc/passwd`)
  expect([400, 404]).toContain(traversal.status())
})

test('prevents a foreign browser origin from reading protected API responses', async ({ page }) => {
  await page.goto('data:text/html,<title>foreign-origin</title>')
  const result = await page.evaluate(async ({ baseUrl, token }) => {
    try {
      await fetch(`${baseUrl}/api/capabilities`, {
        headers: { 'X-Hermes-Session-Token': token }
      })
      return 'readable'
    } catch {
      return 'blocked'
    }
  }, { baseUrl: backend.baseUrl, token: backend.token })

  expect(result).toBe('blocked')
})
