import { expect, test } from './test'
import { selectCreateAction, setupMockBackend, waitForAppReady } from './fixtures'
import { MOCK_REPLY } from './mock-server'

test('tabbed screens isolate tabs, restore them on switch/reload, and omit the minimap', async ({}, testInfo) => {
  const fixture = await setupMockBackend()
  try {
    await waitForAppReady(fixture, 120_000)
    const { page } = fixture
    const screen = (id: string) => page.getByRole('button', { name: `Switch to workspace ${id}`, exact: true })
    const composer = () => page.locator('[contenteditable="true"]:visible').last()
    const send = async (text: string) => {
      await composer().click()
      await composer().pressSequentially(text, { delay: 5 })
      await page.locator('[data-slot="composer-root"]:visible button[type="submit"]').click()
      await expect(page.locator('[data-slot="aui_thread-viewport"]:visible').last()).toContainText(MOCK_REPLY, {
        timeout: 30000
      })
    }
    await expect(screen('1')).toBeVisible()
    await expect(page.locator('[data-scroll-minimap]')).toHaveCount(0)
    await screen('2').click()
    await expect(screen('2')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-slot="composer-surface"]:visible')).toHaveCount(0)
    await selectCreateAction(page, 'New session')
    await expect(page.locator('[data-slot="composer-surface"]:visible')).toHaveCount(1)
    await send('First persisted tab on screen two')
    await selectCreateAction(page, 'New session')
    await expect
      .poll(() =>
        page.evaluate(() => {
          const tree = JSON.parse(localStorage.getItem('hermes.desktop.tabbedScreens.trees.v1')!)['2']
          const panes = (node: { panes?: string[]; children?: unknown[] }): string[] =>
            node.panes ?? (node.children ?? []).flatMap(child => panes(child as typeof node))
          return panes(tree).filter(id => id.startsWith('session-tile:')).length
        })
      )
      .toBe(2)
    await send('Second persisted tab on screen two')
    const secondTree = await page.evaluate(
      () => JSON.parse(localStorage.getItem('hermes.desktop.tabbedScreens.trees.v1')!)['2']
    )
    await screen('1').click()
    await expect(screen('1')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-slot="composer-surface"]:visible')).toHaveCount(1)
    await screen('2').click()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hermes.desktop.layoutTree.v2')!))).toEqual(
      secondTree
    )
    await expect(page.locator('[data-slot="aui_thread-viewport"]:visible').last()).toContainText(
      'Second persisted tab on screen two'
    )
    await page.screenshot({ path: testInfo.outputPath('tabbed-screen-two.png') })
    await page.reload()
    await expect(screen('2')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-slot="composer-surface"]:visible')).toHaveCount(1)
    await expect(page.locator('[data-slot="aui_thread-viewport"]:visible').last()).toContainText(
      'Second persisted tab on screen two',
      { timeout: 30000 }
    )
    await expect(page.locator('[data-scroll-minimap]')).toHaveCount(0)
  } finally {
    await fixture.cleanup()
  }
})
