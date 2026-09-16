import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from './test'
import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'

let fixture: MockBackendFixture

test.beforeEach(async () => {
  // The generic fixture strips *_PASSWORD but file-reference envs are secrets
  // too: never let the operator's real files enter this isolated backend.
  process.env.SUDO_PASSWORD_FILE = ''
  process.env.SUDO_PASSWORD_FILES = ''
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterEach(async () => {
  await fixture?.cleanup()
})

test('sudo settings save/reopen .env and host-file references without readback', async ({}, testInfo) => {
  const { page, sandbox } = fixture
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  const settings = page.locator('[data-settings-surface]')
  await settings.getByRole('button', { name: 'Tools & Keys', exact: true }).click()
  await settings.getByRole('button', { name: 'Sudo credentials', exact: true }).click()
  await expect(settings.getByRole('heading', { name: 'Sudo credentials', exact: true })).toBeVisible()
  await settings.getByLabel('New sudo password', { exact: true }).fill('synthetic-e2e-password')
  await settings.getByRole('button', { name: 'Save password', exact: true }).click()
  await expect(settings.getByText('Password configured', { exact: true })).toBeVisible()
  await expect(settings.getByLabel('New sudo password', { exact: true })).toHaveValue('')
  expect(fs.readFileSync(path.join(sandbox.hermesHome, '.env'), 'utf8')).toContain('SUDO_PASSWORD=')
  const external = path.join(sandbox.root, 'synthetic-sudo-file')
  fs.writeFileSync(external, 'synthetic-host-secret', { mode: 0o600 })
  await settings.getByRole('button', { name: 'Add host', exact: true }).click()
  await settings.getByLabel('Host 1', { exact: true }).fill('192.168.68.57')
  await settings.getByLabel('Password file 1', { exact: true }).fill(external)
  await settings.getByRole('button', { name: 'Save file references', exact: true }).click()
  await expect(settings.getByText('Available', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
  await settings.getByRole('button', { name: 'Tools & Keys', exact: true }).click()
  await settings.getByRole('button', { name: 'Sudo credentials', exact: true }).click()
  await expect(settings.getByLabel('Host 1', { exact: true })).toHaveValue('192.168.68.57')
  await expect(settings.getByLabel('Password file 1', { exact: true })).toHaveValue(external)
  await expect(settings.getByLabel('New sudo password', { exact: true })).toHaveValue('')
  expect(await settings.innerText()).not.toContain('synthetic-e2e-password')
  await settings.getByLabel('File host', { exact: true }).fill('hp')
  await settings.getByLabel('New file password', { exact: true }).fill('synthetic-created-file')
  await settings.getByRole('button', { name: 'Create / replace host password file', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(settings.getByLabel('New file password', { exact: true })).toHaveValue('')
  expect(fs.readFileSync(path.join(sandbox.hermesHome, 'sudo-passwords', 'hp.password'), 'utf8')).toBe('synthetic-created-file')
  for (const width of [1220, 720]) {
    await fixture.app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
      width
    )
    await settings.getByRole('heading', { name: 'Sudo credentials', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`sudo-settings-${width}.png`), fullPage: true })
    await settings.getByRole('button', { name: 'Create / replace host password file', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`sudo-settings-files-${width}.png`), fullPage: true })
  }
})
