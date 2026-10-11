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

for (const width of [393, 1280]) {
  test(`Files icon matches the sidebar icon at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 851 })
    await page.goto(`${backend.baseUrl}/desktop/`)
    await page.getByRole('button', { name: "I'll choose a provider later" }).click()
    const filesIcon = page.getByRole('button', { name: 'Show files', exact: true }).locator('.codicon')
    const sidebarIcon = page.getByRole('button', { name: /^(Show|Hide) sidebar$/ }).locator('.codicon')
    await expect(filesIcon).toBeVisible()
    const referenceSize = await sidebarIcon.evaluate(icon => getComputedStyle(icon).fontSize)
    await expect(filesIcon).toHaveCSS('font-size', referenceSize)
    await expect(filesIcon).toHaveCSS('width', await sidebarIcon.evaluate(icon => getComputedStyle(icon).width))
    await expect(filesIcon).toHaveCSS('height', await sidebarIcon.evaluate(icon => getComputedStyle(icon).height))
    await page.screenshot({ path: testInfo.outputPath('header-icon-parity.png') })
  })
}

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
