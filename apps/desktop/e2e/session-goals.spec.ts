import { expect, test } from '@playwright/test'

import { setupMockBackend, waitForAppReady } from './fixtures'

for (const mode of ['inline', 'inline-exact', 'tool'] as const) {
  test(`sets a standing goal through ${mode} and updates the live indicator`, async () => {
    test.setTimeout(90_000)
    const fixture = await setupMockBackend({ extraConfig: 'goals:\n  max_turns: 1\ntools:\n  tool_search:\n    enabled: off' })
    const { page, mock } = fixture
    const goalEvents: string[] = []
    page.on('websocket', socket => socket.on('framereceived', frame => {
      try {
        const event = JSON.parse(String(frame.payload)).params
        if (event?.type === 'status.update' && event.payload?.kind === 'goal') goalEvents.push(event.payload.text)
      } catch { /* ignore unrelated frames */ }
    }))
    try {
      await page.reload()
      await waitForAppReady(fixture)
      const composer = page.locator('[contenteditable="true"]').first()
      const title = mode !== 'tool' ? 'Verify inline standing goals' : 'Verify the agent-created standing goal'
      if (mode !== 'tool') {
        await composer.fill(`Use the current project. ${mode === 'inline-exact' ? '/goal' : '/go'}`)
        const suggestion = page.getByRole('listbox').getByRole('button', { name: /^\/goal / })
        await expect(suggestion).toBeVisible()
        await page.screenshot({ path: test.info().outputPath(`goal-${mode}-suggestion.png`), fullPage: true })
        await suggestion.click()
        await composer.pressSequentially(title)
      } else {
        await composer.fill('E2E_SESSION_GOAL_TOOL: set a standing goal for this chat')
      }
      await composer.press('Enter')
      await expect.poll(() => goalEvents.some(text => text.includes(title)), { timeout: 45_000 }).toBe(true)
      if (mode !== 'tool') {
        await expect.poll(() => mock.receivedPrompts.some(text => text.includes(`Use the current project. ${title}`))).toBe(true)
      } else {
        await expect(page.getByText('Session goal tool persisted the goal.', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
      }
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
      await page.screenshot({ path: test.info().outputPath(`goal-${mode}.png`), fullPage: true })
      // Reload reads the durable goal, not an optimistic renderer entry.
      await page.reload()
      await waitForAppReady(fixture)
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20_000 })
      await page.screenshot({ path: test.info().outputPath(`goal-${mode}-restored.png`), fullPage: true })
    } finally {
      await fixture.cleanup()
    }
  })
}
