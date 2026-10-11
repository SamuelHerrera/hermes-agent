import { expect, test } from '@playwright/test'

import { type BrowserBackend, startBrowserBackend } from './browser-backend'

let backend: BrowserBackend

test.use({ channel: 'chrome', hasTouch: true, viewport: { width: 393, height: 851 } })
test.beforeAll(async () => {
  backend = await startBrowserBackend({ workspace: true })
})
test.afterAll(async () => {
  await backend?.cleanup()
})

for (const mode of ['tabbed', 'scroll-windows']) {
  test(`${mode}: Show files opens an on-screen panel on a touch viewport`, async ({ page }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem('hermes.desktop.layoutSurfaceMode.v1', value), mode)
    await page.goto(`${backend.baseUrl}/desktop/`)
    await page.getByRole('button', { name: "I'll choose a provider later" }).click()
    await page.getByRole('button', { name: 'Show files', exact: true }).tap()

    const files = page.getByRole('complementary', { name: 'Right sidebar', exact: true })
    await expect(files).toBeVisible()
    // Exercise the real connected-machine filesystem, not a phone file picker.
    await expect(files.getByRole('treeitem', { name: 'backend-file.txt', exact: true })).toBeVisible()
    await files.getByText('backend-folder', { exact: true }).tap()
    await expect(files.getByRole('treeitem', { name: 'nested.txt', exact: true })).toBeVisible()
    const response = await page.request.get(`${backend.baseUrl}/api/fs/read-text`, {
      params: { path: `${backend.workspacePath}/backend-file.txt` },
      headers: { 'X-Hermes-Session-Token': backend.token }
    })
    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({ text: 'Connected backend file\n' })
    await page.screenshot({ path: testInfo.outputPath('files-open.png') })
    const bounds = await files.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(394)
    expect(bounds!.width).toBeGreaterThan(150)
    await page.getByRole('button', { name: 'Hide files', exact: true }).tap()
    await expect(files).not.toBeVisible()
  })
}
