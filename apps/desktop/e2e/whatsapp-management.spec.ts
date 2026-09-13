import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig
} from './fixtures'
import { startMockServer } from './mock-server'

test('WhatsApp management shows saved nonsecret settings and persists edits without pairing', async () => {
  test.setTimeout(120_000)
  const mock = await startMockServer()
  const sandbox = createSandbox('whatsapp-management')
  writeMockProviderConfig(sandbox.hermesHome, mock.url)
  writeEnvFile(sandbox.hermesHome)
  fs.appendFileSync(
    path.join(sandbox.hermesHome, '.env'),
    '\nWHATSAPP_ENABLED=true\nWHATSAPP_MODE=bot\nWHATSAPP_DM_POLICY=allowlist\nWHATSAPP_ALLOWED_USERS=15550001111,15550002222\n'
  )
  const { app, page } = await launchDesktop(buildAppEnv(sandbox))
  const fixture = { app, page, mock, mockUrl: mock.url, sandbox, cleanup: async () => {} }
  try {
    await waitForAppReady(fixture)
    await page.evaluate(() => {
      window.location.hash = '/messaging?platform=whatsapp'
    })
    await expect(page.getByRole('heading', { name: 'WhatsApp', exact: true })).toBeVisible()
    // The real default-profile bridge is running on this host. This isolated
    // profile must not borrow its connected state or linked account.
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0)
    const mode = page.getByRole('combobox', { name: 'Bridge mode', exact: true })
    await expect(mode).toHaveValue('bot')
    await expect(page.getByRole('combobox', { name: 'WhatsApp DM policy', exact: true })).toHaveValue('allowlist')
    await expect(page.getByLabel('Allowed WhatsApp users', { exact: true })).toHaveValue('15550001111,15550002222')
    await mode.selectOption('self-chat')
    await page.getByRole('switch', { name: 'Send read receipts', exact: true }).click()
    await page.getByLabel('Reply header', { exact: true }).fill('My assistant\n')
    await page.getByLabel('Group policy', { exact: true }).selectOption('allowlist')
    await page.getByLabel('Allowed groups', { exact: true }).fill('123@g.us')
    await page.getByRole('switch', { name: 'Require a mention in groups', exact: true }).click()
    await page.getByText('Advanced group settings', { exact: true }).click()
    await page.getByLabel('Mention patterns', { exact: true }).fill('hey hermes\n^bot:')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Bridge mode', exact: true })).toHaveValue('self-chat')
    await expect(page.getByRole('switch', { name: 'Send read receipts', exact: true })).toBeChecked()
    await expect(page.getByLabel('Reply header', { exact: true })).toHaveValue('My assistant\n')
    await expect(page.getByLabel('Group policy', { exact: true })).toHaveValue('allowlist')
    await expect(page.getByLabel('Allowed groups', { exact: true })).toHaveValue('123@g.us')
    await expect(page.getByRole('switch', { name: 'Require a mention in groups', exact: true })).toBeChecked()
    await page.getByText('Advanced group settings', { exact: true }).click()
    await expect(page.getByLabel('Mention patterns', { exact: true })).toHaveValue('hey hermes\n^bot:')
    await page
      .getByRole('switch', { name: 'Send read receipts', exact: true })
      .evaluate(el => el.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: test.info().outputPath('whatsapp-behavior.png'), fullPage: true })
    await page.getByLabel('Mention patterns', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('whatsapp-groups.png'), fullPage: true })
    await expect(page.getByRole('combobox', { name: 'WhatsApp DM policy', exact: true })).toHaveValue('allowlist')
    await expect(page.getByLabel('Allowed WhatsApp users', { exact: true })).toHaveValue('15550001111,15550002222')
    const screenshotPath = test.info().outputPath('whatsapp-management.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })
    await test.info().attach('WhatsApp management', { path: screenshotPath, contentType: 'image/png' })
    await page.getByRole('button', { name: 'Start QR pairing', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('whatsapp-management-actions.png'), fullPage: true })
    expect(fs.existsSync(path.join(sandbox.hermesHome, 'whatsapp/session/creds.json'))).toBe(false)
    expect(fs.existsSync(path.join(sandbox.hermesHome, 'platforms/whatsapp/session/creds.json'))).toBe(false)
  } finally {
    await app.close()
    await mock.close()
    sandbox.cleanup()
  }
})
