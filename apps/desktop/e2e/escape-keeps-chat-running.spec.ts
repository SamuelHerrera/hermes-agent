import { expect, test } from '@playwright/test'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'

const PROMPT = 'E2E_ESCAPE_KEEPS_CHAT_RUNNING'

let fixture: MockBackendFixture

test.beforeAll(async () => {
  fixture = await setupMockBackend({ mockServer: { holdFirstStreamForPrompt: PROMPT } })
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  fixture?.mock.releaseHeldStream()
  await fixture?.cleanup()
})

test('Escape dismisses composer popovers without stopping a run; Stop still works', async ({}, testInfo) => {
  const { page } = fixture
  const editor = page.locator('[contenteditable="true"]').first()
  const stop = page.locator('[data-slot="composer-root"]').getByRole('button', { name: 'Stop', exact: true })

  await editor.click()
  await page.keyboard.insertText(PROMPT)
  await page.keyboard.press('Enter')
  await fixture.mock.waitForHeldStream()
  await expect(stop).toBeVisible()

  // Exercise the real editor handler, including a populated draft.
  await editor.click()
  await page.keyboard.press('Escape')
  await page.keyboard.insertText('draft must survive')
  await page.keyboard.press('Escape')
  await expect(editor).toHaveText('draft must survive')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await expect(stop).toBeVisible()

  // The slash popover still owns Escape, without cancelling the held turn.
  await page.keyboard.insertText('/')
  const popover = page.locator('[data-slot="composer-completion-drawer"]')
  await expect(popover).toBeVisible()
  await expect(popover.getByRole('button').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await expect(stop).toBeVisible()

  // Focus outside all inputs: the former window-level cancellation path.
  await page.locator('[data-slot="aui_thread-viewport"]').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('Escape')
  await page.screenshot({ path: testInfo.outputPath('escape-keeps-chat-running.png') })
  await expect(stop).toBeVisible()
  await stop.click()
  await expect(stop).toHaveCount(0)
})
