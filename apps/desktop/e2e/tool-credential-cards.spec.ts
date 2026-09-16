import fs from 'node:fs'
import path from 'node:path'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture

test.beforeEach(async () => {
  // No operator secrets or external credential files enter this sandbox.
  process.env.SUDO_PASSWORD_FILE = ''
  process.env.SUDO_PASSWORD_FILES = ''
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterEach(async () => { await fixture?.cleanup() })

test('tool service cards edit sandbox credentials in an accessible dialog', async ({}, testInfo) => {
  const { page, sandbox } = fixture
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  const settings = page.locator('[data-settings-surface]')
  await settings.getByRole('button', { name: 'Tools & Keys', exact: true }).click()
  await settings.getByRole('button', { name: 'Tools', exact: true }).click()
  await expect(settings.getByRole('button', { name: 'Firecrawl', exact: true })).toHaveCount(1)
  for (const width of [1220, 720]) {
    await fixture.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width)
    await page.screenshot({ path: testInfo.outputPath(`tool-cards-${width}.png`), fullPage: true })
  }
  const search = settings.getByRole('textbox', { name: 'Search tools, services or keys…' })
  await search.fill('BROWSERBASE_PROJECT_ID')
  await expect(settings.getByRole('button', { name: 'Firecrawl', exact: true })).toHaveCount(0)
  await settings.getByRole('button', { name: 'Browserbase', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Browserbase', exact: true })
  await expect(dialog.getByLabel('BROWSERBASE_PROJECT_ID', { exact: true })).toBeVisible()
  const key = dialog.getByLabel('BROWSERBASE_API_KEY', { exact: true })
  await key.fill('synthetic-tool-card-key')
  await expect(key).toHaveAttribute('type', 'password')
  // Escape cancels a draft before a separate Escape closes the dialog.
  await key.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(key).toHaveValue('')
  await key.fill('synthetic-tool-card-key')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  expect(fs.readFileSync(path.join(sandbox.hermesHome, '.env'), 'utf8')).toContain('BROWSERBASE_API_KEY=synthetic-tool-card-key')
  await page.screenshot({ path: testInfo.outputPath('tool-credential-dialog.png'), fullPage: true })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(settings.getByRole('button', { name: 'Browserbase', exact: true })).toBeFocused()
  await settings.getByRole('button', { name: 'Browserbase', exact: true }).click()
  await expect(key).not.toHaveValue('synthetic-tool-card-key')
  await expect(dialog).not.toContainText('synthetic-tool-card-key')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  // Re-enter the settings view to fetch server truth, rather than only relying
  // on the hook's optimistic is_set patch after saving.
  await page.reload()
  // Reload restores the settings workspace tab, so there need not be a chat
  // composer for waitForAppReady to find.
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: 'Browserbase', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Reveal value', exact: true })).toBeVisible()
  await key.click()
  page.once('dialog', confirmation => void confirmation.accept())
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Reveal value', exact: true })).toHaveCount(0)
  expect(fs.readFileSync(path.join(sandbox.hermesHome, '.env'), 'utf8')).not.toContain('BROWSERBASE_API_KEY=')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  // The largest service group remains usable in a short window.
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 600))
  await settings.getByRole('button', { name: 'Nous Tool Gateway', exact: true }).click()
  const gateway = page.getByRole('dialog', { name: 'Nous Tool Gateway', exact: true })
  const lastField = gateway.getByLabel('TOOL_GATEWAY_USER_TOKEN', { exact: true })
  await lastField.scrollIntoViewIfNeeded()
  await expect(lastField).toBeInViewport()
  await expect(gateway.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('tool-gateway-short-window.png'), fullPage: true })
})
