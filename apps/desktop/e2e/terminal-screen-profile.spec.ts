import fs from 'node:fs'
import path from 'node:path'

import { setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

// eslint-disable-next-line no-empty-pattern -- Electron supplies its own page.
test('profile filtering preserves a live terminal on an inactive desktop', async ({}, testInfo) => {
  const fixture = await setupMockBackend({ extraConfig: 'terminal:\n  cwd: /tmp\n' })
  const { page } = fixture

  try {
    await waitForAppReady(fixture, 120_000)
    const profileHome = path.join(fixture.sandbox.hermesHome, 'profiles', 'terminal-other')
    fs.mkdirSync(profileHome, { recursive: true })
    fs.copyFileSync(path.join(fixture.sandbox.hermesHome, 'config.yaml'), path.join(profileHome, 'config.yaml'))
    await page.reload()
    await waitForAppReady(fixture, 120_000)

    const selectProfile = async (name: string) => {
      await page.getByRole('button', { name: 'Profiles', exact: true }).click()
      await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
    }

    const screen = (id: string) => page.getByRole('button', { name: `Switch to workspace ${id}`, exact: true })

    const savedFive = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('hermes.desktop.tabbedScreens.trees.v1')!)['5'])

    await screen('5').click()
    await page.keyboard.press('Control+`')
    const tab = page.locator('[data-tree-tab^="terminal-instance:"]:visible')
    await expect(tab).toHaveCount(1)
    const pane = (await tab.getAttribute('data-tree-tab'))!
    const id = pane.slice('terminal-instance:'.length)
    const host = page.locator(`[data-persistent-terminal="${id}"]`)
    await expect(host.locator('.xterm')).toBeVisible({ timeout: 30_000 })

    const terminalReference = () =>
      page.evaluate(id => {
        const saved = JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1')!)

        return saved.terminals.find((t: { id: string }) => t.id === id)?.reference
      }, id)

    await expect.poll(terminalReference).toBeTruthy()
    const reference = await terminalReference()
    await screen('1').click()
    const saved = await savedFive()
    await selectProfile('terminal-other')
    await expect(page.locator(`[data-tree-tab="${pane}"]`)).toHaveCount(0)
    expect(await savedFive()).toEqual(saved)
    await expect(screen('5').locator('span.rounded-full')).toHaveCount(0)
    await expect(host.locator('.xterm')).toHaveCount(1)
    expect(await terminalReference()).toEqual(reference)
    await selectProfile('All profiles')
    await expect(screen('5').locator('span.rounded-full')).toHaveCount(1)
    expect(await savedFive()).toEqual(saved)
    await screen('5').click()
    await expect(page.locator(`[data-tree-tab="${pane}"]:visible`)).toHaveCount(1)
    await expect(host.locator('.xterm')).toBeVisible()
    expect(await terminalReference()).toEqual(reference)
    await page.screenshot({ path: testInfo.outputPath('terminal-profile-desktop-restored.png') })
  } finally {
    await fixture.cleanup()
  }
})
