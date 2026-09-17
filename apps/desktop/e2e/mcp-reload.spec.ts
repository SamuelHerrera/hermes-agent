import { expect, test } from '@playwright/test'

import { setupMockBackend, waitForAppReady } from './fixtures'

test('Desktop slash and agent requests use the real reload backend', async () => {
  test.setTimeout(180_000)
  const fixture = await setupMockBackend()

  try {
    await waitForAppReady(fixture, 120_000)
    const { page } = fixture
    const composer = page.locator('[contenteditable="true"]').first()
    const transcript = page.locator('[data-slot="aui_thread-viewport"]')
    const send = async (text: string) => {
      await composer.click()
      await page.keyboard.insertText(text)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
    }

    await send('/reload-mcp')
    await expect(transcript).toContainText('invalidates the prompt cache', { timeout: 60_000 })
    await send('/reload-mcp now')
    await expect(transcript).toContainText('reloaded', { timeout: 60_000 })
    await send('E2E_MCP_RELOAD_TOOL: reload MCP now with my approval')
    await expect(transcript).toContainText('Reload Mcp', { timeout: 90_000 })
    await expect(transcript).toContainText('MCP tools reloaded.', { timeout: 60_000 })
    await page.screenshot({ path: 'test-results/mcp-reload-chat.png' })
  } finally {
    await fixture.cleanup()
  }
})
