import { expect, test } from './test'
import { selectCreateAction, setupMockBackend, waitForAppReady } from './fixtures'

interface Tree {
  id: string
  panes?: string[]
  children?: Tree[]
}

test('empty desktops retain sidebar width through close, move, and reload', async ({}, testInfo) => {
  const fixture = await setupMockBackend()
  try {
    await waitForAppReady(fixture, 120_000)
    const { page } = fixture
    const screen = (id: string) => page.getByRole('button', { name: `Switch to workspace ${id}`, exact: true })
    const tabs = () => page.locator('[data-tree-tab^="session-tile:"]:visible')
    const assertEmpty = async () => {
      await expect(page.locator('[data-empty-workspace]:visible')).toHaveCount(1)
      await expect(page.locator('[data-slot="composer-surface"]:visible')).toHaveCount(0)
      const geometry = await page.evaluate(() => {
        const tree: Tree = JSON.parse(localStorage.getItem('hermes.desktop.layoutTree.v2')!)
        const sidebarGroup = (node: Tree): string | undefined =>
          node.panes?.includes('sessions') ? node.id : node.children?.map(sidebarGroup).find(Boolean)
        const sidebar = document.querySelector(`[data-tree-group="${sidebarGroup(tree)}"]`)!.getBoundingClientRect()
        const empty = [...document.querySelectorAll<HTMLElement>('[data-empty-workspace]')]
          .find(el => el.getBoundingClientRect().width > 0)!
          .getBoundingClientRect()
        return { sidebarWidth: sidebar.width, emptyWidth: empty.width, separate: empty.left >= sidebar.right - 1 }
      })
      expect(geometry.sidebarWidth).toBeGreaterThan(0)
      expect(geometry.sidebarWidth).toBeLessThanOrEqual(520)
      expect(geometry.emptyWidth).toBeGreaterThan(400)
      expect(geometry.separate).toBe(true)
    }
    const moveTo = async (id: string) => {
      // Session chips have their own domain menu; the zone menu owns desktop moves.
      const strip = page.locator('[data-zone-tabstrip]:visible').last()
      const bounds = (await strip.boundingBox())!
      await strip.click({ button: 'right', position: { x: bounds.width * 0.6, y: bounds.height / 2 } })
      await page.getByRole('menuitem', { name: 'Move to desktop', exact: true }).hover()
      await page.getByRole('menuitem', { name: `Desktop ${id}`, exact: true }).click()
      await expect(screen(id)).toHaveAttribute('aria-pressed', 'true')
      await expect(tabs()).toHaveCount(1)
      const separate = await page.evaluate(() => {
        const tree: Tree = JSON.parse(localStorage.getItem('hermes.desktop.layoutTree.v2')!)
        const groups = (node: Tree): Tree[] => (node.panes ? [node] : (node.children ?? []).flatMap(groups))
        return groups(tree).every(
          g => !g.panes!.includes('sessions') || !g.panes!.some(id => id.startsWith('session-tile:'))
        )
      })
      expect(separate).toBe(true)
    }

    await screen('2').click()
    await assertEmpty()
    await selectCreateAction(page, 'New session')
    await expect(tabs()).toHaveCount(1)
    await tabs().first().getByRole('button', { name: 'Close', exact: true }).click()
    await assertEmpty()
    await page.screenshot({ path: testInfo.outputPath('empty-after-final-close.png') })
    await page.reload()
    await expect(screen('2')).toHaveAttribute('aria-pressed', 'true')
    await assertEmpty()

    await selectCreateAction(page, 'New session')
    await expect(tabs()).toHaveCount(1)
    await moveTo('3')
    await screen('2').click()
    await assertEmpty()
    await screen('3').click()
    await moveTo('2')
    await selectCreateAction(page, 'New session')
    await expect(tabs()).toHaveCount(2)
    await tabs().first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Close all', exact: true }).click()
    await assertEmpty()
    await screen('1').click()
    await expect(page.locator('[data-slot="composer-surface"]:visible')).toHaveCount(1)
    await screen('3').click()
    await assertEmpty()
    await page.screenshot({ path: testInfo.outputPath('empty-with-other-desktop-occupied.png') })
  } finally {
    await fixture.cleanup()
  }
})
