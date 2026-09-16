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
  // The sole reference affordance lives beside the text input, never across
  // the transcript. Its geometry must fit the actual accepted drop region.
  const overlay = input.locator('..').locator('[data-slot="chat-drop-overlay"]')
  await expect(overlay).toHaveCSS('opacity', '1')
  const overlayBox = (await overlay.boundingBox())!
  const inputBox = (await input.boundingBox())!
  expect(overlayBox.height).toBeLessThanOrEqual(inputBox.height + 1)
  await page.screenshot({ path: testInfo.outputPath('reference-input-only-drop.png') })
  await page.mouse.up()
  await expect(input.locator('[data-ref-kind="session"]')).toHaveCount(0)
  await expect(input).toHaveText('')

  await dragTo(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2)
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
})
