import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { buildAppEnv, launchDesktop, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

test('persistent terminal retains shell and btop across complete Desktop quit/reopen', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = await setupMockBackend()
  let current = { app: fixture.app, page: fixture.page }
  const receipt = path.join(fixture.sandbox.root, 'terminal-proof')
  const hostDir = path.join(fixture.sandbox.hermesHome, 'terminal-host', 'runtime')
  try {
    await waitForAppReady(fixture, 120_000)
    await current.page.keyboard.press('Control+`')
    const terminal = () => current.page.locator('[data-persistent-terminal] .xterm-helper-textarea').first()
    await expect(terminal()).toBeVisible({ timeout: 30_000 })
    // Wait for the durable identity, not merely an empty xterm DOM.
    const reference = () => current.page.evaluate(() => JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') || '{}').terminals?.[0]?.reference)
    await expect.poll(reference, { timeout: 30_000 }).toBeTruthy()
    const saved = await reference()
    const command = async (text: string) => {
      await terminal().focus()
      await current.page.keyboard.type(text)
      await current.page.keyboard.press('Enter')
    }
    await command(`HERMES_PERSIST_PROOF=survived; printf '%s:%s' "$$" "$HERMES_PERSIST_PROOF" > '${receipt}'; btop`)
    await expect.poll(() => fs.existsSync(receipt) ? fs.readFileSync(receipt, 'utf8') : '').toMatch(/\d+:survived/)
    const before = fs.readFileSync(receipt, 'utf8')
    await expect.poll(() => execFileSync('pgrep', ['-P', before.split(':')[0], 'btop'], { encoding: 'utf8' }).trim()).toMatch(/\d+/)
    const btop = execFileSync('pgrep', ['-P', before.split(':')[0], 'btop'], { encoding: 'utf8' }).trim()
    await current.page.screenshot({ path: testInfo.outputPath('before-quit.png') })
    await current.app.close()
    process.kill(Number(btop), 0)
    current = await launchDesktop(buildAppEnv(fixture.sandbox))
    await waitForAppReady({ ...fixture, ...current }, 120_000)
    await expect.poll(reference, { timeout: 30_000 }).toEqual(saved)
    await current.page.locator('[data-tree-tab^="terminal-instance:"]').first().click()
    await expect(terminal()).toBeVisible({ timeout: 30_000 })
    process.kill(Number(btop), 0)
    await current.page.screenshot({ path: testInfo.outputPath('after-reopen.png') })
    await terminal().focus()
    await current.page.keyboard.press('q')
    await expect.poll(() => { try { process.kill(Number(btop), 0); return false } catch { return true } }).toBe(true)
    await command(`printf '%s:%s' "$$" "$HERMES_PERSIST_PROOF" > '${receipt}.after'`)
    await expect.poll(() => fs.existsSync(`${receipt}.after`) ? fs.readFileSync(`${receipt}.after`, 'utf8') : '').toBe(before)
    console.log(JSON.stringify({ sameShell: before, sameBtop: btop, durableIdentity: saved }))
  } finally {
    await current.app.close().catch(() => {})
    const bundle = path.resolve('dist/terminal-host')
    try { execFileSync(path.join(bundle, process.platform === 'win32' ? 'node.exe' : 'node'), [path.join(bundle, 'package/src/cli.mjs'), 'stop', '--force', '--dir', hostDir], { timeout: 15000, stdio: 'pipe' }) } catch { /* Host may not have started. */ }
    await fixture.cleanup()
  }
})
