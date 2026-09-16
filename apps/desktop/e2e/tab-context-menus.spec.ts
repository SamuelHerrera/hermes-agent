import { selectCreateAction, setupMockBackend, waitForAppReady } from './fixtures'
import { MOCK_REPLY } from './mock-server'
import { expect, test } from './test'

for (const scrolling of [false, true]) {
  // Playwright requires destructured fixtures; this suite owns its isolated Electron fixture.
  // eslint-disable-next-line no-empty-pattern
  test(`${scrolling ? 'scroll headers' : 'normal tabs'} share session actions and move between desktops`, async ({}, testInfo) => {
    const fixture = await setupMockBackend()

    try {
      await waitForAppReady(fixture, 120_000)
      const { page } = fixture
      await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1700, 1000))

      if (scrolling) {
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
        await page.getByPlaceholder(/search/i).fill('scroll window')
        await page.mouse.move(8, 8)
        await page.locator('[data-slot="command-item"]').filter({ hasText: 'Toggle scroll-window layout' }).click()
        await page.keyboard.press('Escape')
      }

      const desktop = (id: string) => page.getByRole('button', { name: `Switch to workspace ${id}`, exact: true })

      const header = (id: string) => scrolling
        ? page.locator(`[data-scroll-window="${id}"] [data-scroll-window-header]`)
        : page.locator(`[data-tree-tab="${id}"]:visible`)

      const send = async (text: string, paneId: string) => {
        await header(paneId).click()
        const surface = scrolling ? page.locator(`[data-scroll-window="${paneId}"]`) : page
        const composer = surface.locator('[contenteditable="true"]:visible').last()
        await composer.click()
        await composer.pressSequentially(text, { delay: 5 })
        await surface.locator('[data-slot="composer-root"]:visible button[type="submit"]').last().click()
        await expect(page.locator('[data-slot="aui_thread-viewport"]:visible').last()).toContainText(MOCK_REPLY, { timeout: 30_000 })
      }

      const move = async (paneId: string, from: string, to: string) => {
        await header(paneId).click({ button: 'right' })
        await expect(page.getByRole('menuitem', { name: /rename/i })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /move to project/i })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Reload', exact: true })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Close all', exact: true })).toBeVisible()
        await expect(page.locator('[role="menu"]:visible')).toHaveCount(1)
        await page.screenshot({ path: testInfo.outputPath(`${paneId === 'workspace' ? 'primary' : 'saved'}-menu.png`) })
        await page.getByRole('menuitem', { name: 'Move to desktop', exact: true }).hover()
        await expect(page.getByRole('menuitem', { name: `Desktop ${from}`, exact: true })).toBeDisabled()
        await page.getByRole('menuitem', { name: `Desktop ${to}`, exact: true }).click()
        await expect(desktop(to)).toHaveAttribute('aria-pressed', 'true')
        await expect(header(paneId)).toBeVisible()
        await desktop(from).click()
        await expect(header(paneId)).toHaveCount(0)
        await desktop(to).click()
        await expect(header(paneId)).toBeVisible()
      }

      await send('Primary saved chat for context menu regression', 'workspace')
      await move('workspace', '1', '2')
      await selectCreateAction(page, 'New session')


      const tiles = scrolling
        ? page.locator('[data-scroll-window^="session-tile:"]')
        : page.locator('[data-tree-tab^="session-tile:"]:visible')

      await expect(tiles).toHaveCount(1)
      const draftId = (await tiles.last().getAttribute(scrolling ? 'data-scroll-window' : 'data-tree-tab'))!
      await send('Second saved chat for context menu regression', draftId)
      const tileId = (await tiles.last().getAttribute(scrolling ? 'data-scroll-window' : 'data-tree-tab'))!
      await move(tileId, '2', '3')
      await page.reload()
      await expect(desktop('3')).toHaveAttribute('aria-pressed', 'true')
      await expect(header(tileId)).toBeVisible()
      await desktop('2').click()
      await header('workspace').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Close all', exact: true }).click()
      await expect(page.locator('[data-slot="composer-surface"]:visible')).toHaveCount(0)
      await desktop('3').click()
      await expect(header(tileId)).toBeVisible()
      await expect(page.locator('[data-slot="aui_thread-viewport"]:visible').last()).toContainText(MOCK_REPLY, { timeout: 30_000 })
      await page.screenshot({ path: testInfo.outputPath('surviving-desktop.png') })
      await move(tileId, '3', '1')
    } finally {
      await fixture.cleanup()
    }
  })
}
