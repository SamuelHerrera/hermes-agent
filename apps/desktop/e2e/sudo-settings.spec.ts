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

test('host inspector saves direct values and browses backend file references without readback', async ({}, testInfo) => {
  const { page, sandbox } = fixture
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  const settings = page.locator('[data-settings-surface]')
  await settings.getByRole('button', { name: 'Tools & Keys', exact: true }).click()
  await settings.getByRole('button', { name: 'Sudo credentials', exact: true }).click()
  await expect(settings.getByRole('heading', { name: 'Sudo credentials', exact: true })).toBeVisible()
  await settings.getByLabel('New sudo password', { exact: true }).fill('synthetic-e2e-password')
  await settings.getByRole('button', { name: 'Save password', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(settings.getByText('Available', { exact: true })).toBeVisible()
  await expect(settings.getByLabel('New sudo password', { exact: true })).toHaveValue('')
  const localFile = path.join(sandbox.hermesHome, 'sudo-passwords', 'local.password')
  expect(fs.readFileSync(localFile, 'utf8')).toBe('synthetic-e2e-password')
  expect(fs.statSync(localFile).mode & 0o777).toBe(0o600)
  const external = path.join(sandbox.root, 'synthetic-sudo-file')
  fs.writeFileSync(external, 'synthetic-host-secret', { mode: 0o600 })
  await settings.getByRole('button', { name: 'Add host', exact: true }).click()
  await settings.getByLabel('Host', { exact: true }).fill('192.168.68.57')
  await settings.getByRole('button', { name: 'Select file', exact: true }).click()
  await settings.getByRole('button', { name: 'Browse files', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Browse files' })
  await picker.getByLabel('Backend folder', { exact: true }).fill(sandbox.root)
  await picker.getByRole('button', { name: 'Go', exact: true }).click()
  await picker.getByRole('button', { name: 'synthetic-sudo-file', exact: true }).click()
  await expect(settings.getByLabel('Password file', { exact: true })).toHaveValue(fs.realpathSync(external))
  await settings.getByRole('button', { name: 'Save reference', exact: true }).click()
  await expect(settings.getByText('Available', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
  await settings.getByRole('button', { name: 'Tools & Keys', exact: true }).click()
  await settings.getByRole('button', { name: 'Sudo credentials', exact: true }).click()
  await settings.getByRole('button', { name: '192.168.68.57', exact: true }).click()
  await expect(settings.getByLabel('Password file', { exact: true })).toHaveValue(fs.realpathSync(external))
  expect(await settings.innerText()).not.toContain('synthetic-e2e-password')
  await settings.getByRole('button', { name: 'Add host', exact: true }).click()
  await settings.getByLabel('Host', { exact: true }).fill('hp')
  await settings.getByLabel('New sudo password', { exact: true }).fill('synthetic-created-file')
  await settings.getByRole('button', { name: 'Save password', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(settings.getByRole('button', { name: 'hp', exact: true })).toBeVisible()
  expect(fs.readFileSync(path.join(sandbox.hermesHome, 'sudo-passwords', 'hp.password'), 'utf8')).toBe(
    'synthetic-created-file'
  )
  await settings.getByRole('button', { name: 'Enter password', exact: true }).click()
  await expect(settings.getByLabel('New sudo password', { exact: true })).toHaveValue('')
  await settings.getByLabel('New sudo password', { exact: true }).fill('synthetic-replacement')
  await settings.getByRole('button', { name: 'Save password', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(settings.getByText('Saved', { exact: true })).toBeVisible()
  await expect(settings.getByLabel('New sudo password', { exact: true })).toHaveValue('')
  expect(fs.readFileSync(path.join(sandbox.hermesHome, 'sudo-passwords', 'hp.password'), 'utf8')).toBe(
    'synthetic-replacement'
  )
  expect(fs.readFileSync(external, 'utf8')).toBe('synthetic-host-secret')
  for (const width of [1220, 720]) {
    await fixture.app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
      width
    )
    await settings.getByRole('heading', { name: 'Sudo credentials', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`sudo-settings-${width}.png`), fullPage: true })
    await settings.getByRole('button', { name: 'Select file', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath(`sudo-settings-files-${width}.png`), fullPage: true })
    await settings.getByRole('button', { name: 'Enter password', exact: true }).click()
  }
})
