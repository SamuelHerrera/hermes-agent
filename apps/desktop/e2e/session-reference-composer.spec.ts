import { expect, test } from './test'

import { type MockBackendFixture, selectCreateAction, setupMockBackend, waitForAppReady } from './fixtures'
import { MOCK_REPLY } from './mock-server'

const TITLE = 'Reference source planning'
const INPUT = '[data-slot="composer-rich-input"]:visible'

let fixture: MockBackendFixture

test.beforeEach(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterEach(async () => {
  await fixture?.cleanup()
})

test('only the text input accepts chat references and typing retains the title', async ({}, testInfo) => {
  const { page } = fixture
  const input = page.locator(INPUT).last()
  await input.fill('Create a source chat for reference testing')
  await page.keyboard.press('Enter')
  await expect(page.getByText(MOCK_REPLY, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await input.fill(`/title ${TITLE}`)
  await page.keyboard.press('Enter')

  const source = page.getByRole('tab', { name: `${TITLE} Close`, exact: true })
  await expect(source).toBeVisible()
  await selectCreateAction(page, 'New session')
  await expect(input).toHaveText('')

  const surface = page.locator('[data-chat-surface]:visible').last()
  const dragTo = async (x: number, y: number) => {
    const box = (await source.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 4 })
    await page.mouse.move(x, y, { steps: 15 })
  }

  const surfaceBox = (await surface.boundingBox())!
  await dragTo(surfaceBox.x + surfaceBox.width / 2, surfaceBox.y + surfaceBox.height / 2)
  // Same-pane center drops neither change the input nor move/activate a tab.
  const overlay = input.locator('..').locator('[data-slot="chat-drop-overlay"]')
  await expect(overlay).toHaveCSS('opacity', '0')
  const inputBox = (await input.boundingBox())!
  await page.mouse.up()
  await expect(source).toHaveAttribute('aria-selected', 'false')
  await expect(input.locator('[data-ref-kind="session"]')).toHaveCount(0)
  await expect(input).toHaveText('')

  await dragTo(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2)
  await expect(overlay).toHaveCSS('opacity', '1')
  const overlayBox = (await overlay.boundingBox())!
  expect(overlayBox.height).toBeLessThanOrEqual(inputBox.height + 1)
  await page.screenshot({ path: testInfo.outputPath('reference-input-only-drop.png') })
  await page.mouse.up()
  const chip = input.locator('[data-ref-kind="session"]')
  await expect(chip).toHaveText(TITLE)
  const wireValue = await chip.getAttribute('data-ref-text')
  expect(wireValue).toMatch(/^@session:`default\/.+`$/)

  for (const character of [' ', 'x', 'y']) {
    await page.keyboard.type(character)
    await expect(chip).toHaveText(TITLE)
    await expect(chip).toHaveAttribute('data-ref-text', wireValue!)
    await expect(input).toContainText(character.trim() || TITLE)
  }
  await page.screenshot({ path: testInfo.outputPath('reference-label-after-typing.png') })

  // Split the source into another pane, then move it back by the target's
  // center. Input hover is scoped to one composer and clears on the way out.
  const targetAnchor = await surface.getAttribute('data-session-anchor')
  const targetSurface = page.locator(`[data-session-anchor="${targetAnchor}"]:visible`)
  const beforeSplit = (await targetSurface.boundingBox())!
  await dragTo(beforeSplit.x + beforeSplit.width - 10, beforeSplit.y + beforeSplit.height / 2)
  await page.mouse.up()
  await expect(page.locator('[data-chat-surface]:visible')).toHaveCount(2)
  const groupOf = () => source.evaluate(el => el.closest('[data-tree-group]')?.getAttribute('data-tree-group'))
  const targetGroup = await targetSurface.evaluate(el => el.closest('[data-tree-group]')?.getAttribute('data-tree-group'))
  expect(await groupOf()).not.toBe(targetGroup)

  const targetInput = targetSurface.locator(INPUT)
  const targetOverlay = targetInput.locator('..').locator('[data-slot="chat-drop-overlay"]')
  const targetBox = (await targetInput.boundingBox())!
  await dragTo(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
  await expect(targetOverlay).toHaveCSS('opacity', '1')
  const otherOverlay = page
    .locator(`[data-chat-surface]:visible:not([data-session-anchor="${targetAnchor}"])`)
    .locator('[data-slot="composer-rich-input"]')
    .locator('..')
    .locator('[data-slot="chat-drop-overlay"]')
  await expect(otherOverlay).toHaveCSS('opacity', '0')

  const center = (await targetSurface.boundingBox())!
  await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2, { steps: 15 })
  await expect(targetOverlay).toHaveCSS('opacity', '0')
  await page.screenshot({ path: testInfo.outputPath('center-pane-stacking.png') })
  await page.mouse.up()
  await expect.poll(groupOf).toBe(targetGroup)
  await expect(page.locator('[data-chat-surface]:visible')).toHaveCount(1)
  await expect(source).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({ path: testInfo.outputPath('tabs-stacked-after-center-drop.png') })
})
