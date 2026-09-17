import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test } from './test'
import { buildAppEnv, createSandbox, launchDesktop } from './fixtures'

// Unlike the general suite, this exercises the native zoom default, not the
// fixture's 100% baseline. HOME is isolated as well, so no provider can adopt
// the developer's external CLI login during this first-run check.
test('a fresh install paints the shipped theme and still requires sign-in', async () => {
  const sandbox = createSandbox('install-defaults')
  fs.rmSync(path.join(sandbox.userDataDir, 'zoom-state.json'))
  fs.writeFileSync(path.join(sandbox.hermesHome, 'config.yaml'), '{}\n')
  const { app, page } = await launchDesktop(buildAppEnv(sandbox, { HOME: sandbox.root }))

  try {
    const chooseLater = page.getByRole('button', { name: "I'll choose a provider later" })
    await expect(chooseLater).toBeVisible({ timeout: 90_000 })
    await expect(page.locator('html')).toHaveAttribute('data-hermes-theme', 'mono')
    await expect(page.locator('html')).toHaveAttribute('data-hermes-mode', 'dark')
    const native = await app.evaluate(({ BrowserWindow, nativeTheme }) => {
      const win = BrowserWindow.getAllWindows().find((w: { isVisible(): boolean }) => w.isVisible())!
      return {
        mode: nativeTheme.themeSource,
        zoomPercent: Math.round(win.webContents.getZoomFactor() * 100),
        opacity: win.getOpacity()
      }
    })
    expect(native.mode).toBe(await page.locator('html').getAttribute('data-hermes-mode'))
    expect(native.zoomPercent).toBe(90)
    if (process.platform !== 'linux') expect(native.opacity).toBeLessThan(1)
    await page.screenshot({ path: test.info().outputPath('fresh-install.png') })
    await chooseLater.click()
    await expect(chooseLater).not.toBeVisible()
    await page.screenshot({ path: test.info().outputPath('fresh-install-shell.png') })
  } finally {
    await app.close()
    sandbox.cleanup()
  }
})
