import { expect, test } from './test'
import { setupMockBackend, waitForAppReady } from './fixtures'
import { createBackgroundReleaseHandle, restartMockServer, SIDEBAR_CROSS_TEXTS } from './mock-server'

test('background processes remain visible in chat without a terminal glyph on its tab', async ({}, testInfo) => {
  test.setTimeout(150_000)
  const background = createBackgroundReleaseHandle()
  const fixture = await setupMockBackend({ mockServer: { backgroundReleasePath: background.path } })

  try {
    await waitForAppReady(fixture, 120_000)
    const { page } = fixture
    const composer = page.locator('[contenteditable="true"]:visible').first()
    await composer.fill('Hello')
    await composer.press('Enter')
    await expect(page.locator('[data-slot="aui_thread-viewport"]')).toContainText('mock inference server')
    restartMockServer()
    await composer.fill('E2E_SIDEBAR_CROSS')
    await composer.press('Enter')
    await expect(page.locator('[data-slot="aui_thread-viewport"]')).toContainText(
      SIDEBAR_CROSS_TEXTS.finalText,
      { timeout: 90_000 },
    )

    await expect(page.getByRole('button', { name: '1 Background', exact: true })).toBeVisible({ timeout: 15_000 })
    const tabs = page.locator('[data-tree-tab="workspace"], [data-tree-tab^="session-tile:"]')
    await expect(tabs.first()).toBeVisible()
    await expect(tabs.locator('.codicon-terminal')).toHaveCount(0)
    await expect(tabs.locator('[data-session-attention-dot][data-session-status="background"]')).toHaveCount(0)
    await expect(tabs.locator('[data-session-project-dot]').first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('background-without-tab-terminal.png') })
  } finally {
    background.release()
    await fixture.cleanup()
    background.cleanup()
  }
})
