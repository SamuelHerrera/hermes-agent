import fs from 'node:fs'
import path from 'node:path'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture

test.afterEach(async () => {
  await fixture?.cleanup()
})

test('profile filtering hides terminal tabs without disposing their live shells', async () => {
  fixture = await setupMockBackend({ extraConfig: 'terminal:\n  cwd: /tmp\n' })
  await waitForAppReady(fixture, 120_000)
  // A real second profile/backend, isolated from the user's profiles. Only the
  // inference provider is mocked; profile switching, Electron and PTYs are real.
  const profileHome = path.join(fixture.sandbox.hermesHome, 'profiles', 'terminal-other')
  fs.mkdirSync(profileHome, { recursive: true })
  fs.copyFileSync(path.join(fixture.sandbox.hermesHome, 'config.yaml'), path.join(profileHome, 'config.yaml'))
  const page = fixture.page
  await page.reload()
  await waitForAppReady(fixture, 120_000)

  const selectProfile = async (name: string) => {
    await page.getByRole('button', { name: 'Profiles', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
  }

  await page.keyboard.press('Control+`')
  const tabs = page.locator('[data-tree-tab^="terminal-instance:"]')
  await expect(tabs).toHaveCount(1)
  const pane = (await tabs.first().getAttribute('data-tree-tab'))!
  const id = pane.slice('terminal-instance:'.length)
  const host = page.locator(`[data-persistent-terminal="${id}"]`)
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 30_000 })
  await host.locator('textarea').focus()
  await page.keyboard.type('export HERMES_PROFILE_SHELL=still_alive')
  await page.keyboard.press('Enter')

  await selectProfile('terminal-other')
  await expect(tabs).toHaveCount(0)
  await expect(host).toHaveAttribute('aria-hidden', 'true')
  await expect(host.locator('.xterm')).toHaveCount(1)
  await page.keyboard.press('Control+`')
  await expect(tabs).toHaveCount(1)
  const otherPane = (await tabs.first().getAttribute('data-tree-tab'))!
  expect(otherPane).not.toBe(pane)

  await selectProfile('default')
  await expect(tabs).toHaveCount(1)
  await expect(tabs.first()).toHaveAttribute('data-tree-tab', pane)
  await tabs.first().click()
  await expect(host).toHaveAttribute('aria-hidden', 'false')
  await host.locator('textarea').focus()
  await page.keyboard.type('printf "SURVIVED=%s\\n" "$HERMES_PROFILE_SHELL"')
  await page.keyboard.press('Enter')
  await expect
    .poll(() =>
      page.evaluate(terminalId => {
        const saved = JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') ?? '{}')

        return saved.terminals?.find((terminal: { id: string }) => terminal.id === terminalId)?.reviveBuffer ?? ''
      }, id)
    )
    .toContain('SURVIVED=still_alive')

  await selectProfile('All profiles')
  await expect(tabs).toHaveCount(2)
  await page.locator(`[data-tree-tab="${otherPane}"]`).click({ button: 'middle' })
  await expect(tabs).toHaveCount(1)
  await selectProfile('terminal-other')
  await expect(tabs).toHaveCount(0)
  await selectProfile('default')
  await selectProfile('All profiles')
  await expect(tabs).toHaveCount(1)
  await expect(tabs.first()).toHaveAttribute('data-tree-tab', pane)
  await page.screenshot({ path: 'test-results/terminal-profile-filter.png' })
})
