import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

// eslint-disable-next-line no-empty-pattern -- Electron supplies its own page.
test('file opens use the caller panel and global opens use the focused panel', async ({}, testInfo) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-same-panel-'))
  fs.writeFileSync(path.join(directory, 'same-panel.txt'), 'Same-panel file preview works.\n')
  const fixture = await setupMockBackend({ extraConfig: `terminal:\n  cwd: ${JSON.stringify(directory)}\n` })

  try {
    await waitForAppReady(fixture, 120_000)
    const { page, app } = fixture

    const groups = () => page.locator('[data-tree-group]:visible').evaluateAll(nodes => nodes.map(node => ({
      id: node.getAttribute('data-tree-group')!,
      panes: [...node.querySelectorAll('[data-tree-tab]')].map(tab => tab.getAttribute('data-tree-tab')!)
    })))

    const groupOf = async (pane: string) => (await groups()).find(group => group.panes?.includes(pane))!.id
    // Supply only the native chooser result; file reading and preview remain real.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, path.join(directory, 'same-panel.txt'))
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Files…', exact: true }).click()
    const file = page.getByRole('button', { name: 'Preview same-panel.txt', exact: true })
    await expect(file).toBeVisible()
    const caller = await groupOf('workspace')
    const before = (await groups()).map(group => group.id)
    await file.click()
    const preview = page.locator('[data-tree-tab^="preview-tile:file:"]:visible')
    await expect(preview).toHaveCount(1)
    const previewId = (await preview.getAttribute('data-tree-tab'))!
    expect(await groupOf(previewId)).toBe(caller)
    expect((await groups()).map(group => group.id)).toEqual(before)
    await expect(page.getByText('Same-panel file preview works.', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('file-in-caller-panel.png'), fullPage: true })

    await page.locator('[data-tree-tab="workspace"]:visible').click()
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('menuitem', { name: 'URL…', exact: true }).click()
    await page.getByPlaceholder('https://example.com/post').fill(`${fixture.mockUrl}/v1/models`)
    await page.getByRole('button', { name: 'Attach', exact: true }).click()
    await page.locator('[data-slot="composer-attachments"] button[aria-label^="Preview "]').last().click()
    const browser = page.locator('[data-tree-tab="preview-tile:url:browser"]:visible')
    await expect(browser).toBeVisible()
    expect(await groupOf('preview-tile:url:browser')).toBe(caller)
    expect((await groups()).map(group => group.id)).toEqual(before)

    // A deliberate edge drag still creates a split. Global opens follow it.
    const header = (await browser.boundingBox())!
    const panel = (await page.locator(`[data-tree-group="${caller}"]`).boundingBox())!
    await page.mouse.move(header.x + 50, header.y + header.height / 2)
    await page.mouse.down()
    await page.mouse.move(header.x + 70, header.y + header.height / 2, { steps: 6 })
    await page.mouse.move(panel.x + panel.width - 20, panel.y + panel.height / 2, { steps: 15 })
    await page.mouse.up()
    await expect.poll(async () => (await groups()).length).toBe(before.length + 1)
    const focused = await groupOf('preview-tile:url:browser')
    expect(focused).not.toBe(caller)
    const afterSplit = (await groups()).map(group => group.id)

    // The menu is outside all panels; it must reuse the panel just focused.
    await browser.click()
    await page.getByRole('button', { name: 'More app actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Views', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Capabilities', exact: true }).click()
    await expect(page.locator('[data-tree-tab="route-tile:/skills"]:visible')).toHaveCount(1)
    expect(await groupOf('route-tile:/skills')).toBe(focused)
    expect((await groups()).map(group => group.id)).toEqual(afterSplit)

    await page.getByRole('button', { name: 'New terminal', exact: true }).click()
    const terminal = page.locator('[data-tree-tab^="terminal-instance:"]:visible')
    await expect(terminal).toHaveCount(1)
    expect(await groupOf((await terminal.getAttribute('data-tree-tab'))!)).toBe(focused)
    expect((await groups()).map(group => group.id)).toEqual(afterSplit)
    await expect(page.locator('.xterm:visible').first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('global-opens-in-focused-panel.png'), fullPage: true })
  } finally {
    await fixture.cleanup()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
