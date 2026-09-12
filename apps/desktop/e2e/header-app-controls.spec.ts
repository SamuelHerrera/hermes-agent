import { expect, test } from './test'
import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'

let fixture: MockBackendFixture

test.beforeEach(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterEach(async () => {
  await fixture?.cleanup()
})

test('compact app controls stay in the header and extra actions stay in the menu', async ({}, testInfo) => {
  const { page, app } = fixture
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const toolbar = page.getByLabel('App controls', { exact: true })
  const menu = toolbar.getByRole('button', { name: 'More app actions' })
  const newSession = toolbar.getByRole('button', { name: 'New session', exact: true })
  const inlineNames = () => toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))

  await expect(newSession).toBeVisible()
  const baseline = await inlineNames()
  const rect = await toolbar.boundingBox()
  expect(rect).not.toBeNull()
  expect(rect!.y).toBeLessThan(20)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(34)

  // Native drag regions must not cover any part of the fixed toolbar.
  await expect.poll(() => page.evaluate(() => {
    const toolbar = document.querySelector('[aria-label="App controls"]')!.getBoundingClientRect()
    return [...document.querySelectorAll('div')].filter(element =>
      getComputedStyle(element).getPropertyValue('-webkit-app-region') === 'drag'
    ).every(element => {
      const box = element.getBoundingClientRect()
      return box.width === 0 || box.height === 0 || box.right <= toolbar.left || box.left >= toolbar.right || box.bottom <= toolbar.top || box.top >= toolbar.bottom
    })
  })).toBe(true)

  await page.screenshot({ path: testInfo.outputPath('header-wide.png'), fullPage: true })
  await toolbar.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await expect(newSession).toBeVisible()
  await menu.click()
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await toolbar.getByRole('button', { name: 'Show sidebar', exact: true }).click()

  for (const width of [720, 1600]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    await expect(newSession).toBeVisible()
    await expect.poll(inlineNames).toEqual(baseline)
    await expect(toolbar.getByRole('button', { name: 'Capabilities', exact: true })).toHaveCount(0)
    await menu.click()
    await expect(page.getByRole('menuitem', { name: 'Capabilities', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Messaging', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`header-menu-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
  }

  await menu.click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('tab', { name: /Settings/ })).toBeVisible()
  expect(errors).toEqual([])
})
