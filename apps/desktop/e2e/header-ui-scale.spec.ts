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

test('header UI scale adjusts live, stays open and persists after reload', async ({}, testInfo) => {
  const { page, app } = fixture
  await page.getByRole('button', { name: 'More app actions', exact: true }).click()
  const scale = page.getByRole('group', { name: 'UI Scale', exact: true })
  const reset = scale.getByRole('menuitem', { name: 'Reset UI scale to 90%' })
  await expect(reset).toHaveText('100%')
  await scale.getByRole('menuitem', { name: 'Increase UI scale' }).click()
  await expect(reset).toHaveText('110%')
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        Math.round(BrowserWindow.getAllWindows()[0].webContents.getZoomFactor() * 100)
      )
    )
    .toBe(110)
  await scale.getByRole('menuitem', { name: 'Decrease UI scale' }).click()
  await expect(reset).toHaveText('100%')
  await reset.click()
  await expect(reset).toHaveText('90%')
  await page.screenshot({ path: testInfo.outputPath('header-ui-scale.png'), fullPage: true })
  await expect
    .poll(() =>
      scale.evaluate(element => {
        const menu = element.closest('[data-slot="dropdown-menu-content"]')!.getBoundingClientRect()
        return [...element.querySelectorAll('button')].every(button => {
          const bounds = button.getBoundingClientRect()
          return bounds.left >= menu.left && bounds.right <= menu.right
        })
      })
    )
    .toBe(true)
  await page.keyboard.press('Escape')
  await page.reload()
  await waitForAppReady(fixture, 120_000)
  await page.getByRole('button', { name: 'More app actions', exact: true }).click()
  await expect(reset).toHaveText('90%')
})
