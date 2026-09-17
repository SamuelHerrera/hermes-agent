import { setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

// eslint-disable-next-line no-empty-pattern -- Electron supplies its own page.
test('repairs desktop five rails and forgets closed and deleted terminal occupancy', async ({}, testInfo) => {
  const fixture = await setupMockBackend({ extraConfig: 'terminal:\n  cwd: /tmp\n' })
  const { page } = fixture
  const screen = (id: string) => page.getByRole('button', { name: `Switch to workspace ${id}`, exact: true })
  const dot = () => screen('5').locator('span.rounded-full')

  try {
    await waitForAppReady(fixture, 120_000)
    // Replay the saved topology from the report, not the newer default tree.
    await page.evaluate(async folder => {
      const desktop = (window as typeof window & {
        hermesDesktop: { getConnection: () => Promise<{ wsUrl: string }> }
      }).hermesDesktop

      const { wsUrl } = await desktop.getConnection()
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl!)

        const timer = setTimeout(() => {
          ws.close()
          reject(new Error('Project creation timed out'))
        }, 15_000)

        ws.onopen = () =>
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'projects.create',
              params: { name: 'Desktop five fixture', folders: [folder] }
            })
          )

        ws.onmessage = event => {
          const result = JSON.parse(String(event.data))

          if (result.id !== 1) {return}
          clearTimeout(timer)
          ws.close()

          if (result.error) {reject(new Error(JSON.stringify(result.error)))}
          else {resolve()}
        }
      })
    }, fixture.sandbox.root)
    await page.evaluate(() => {
      const screens = JSON.parse(localStorage.getItem('hermes.desktop.tabbedScreens.trees.v1') ?? '{}')
      screens['5'] = {
        type: 'split',
        id: 'legacy-five',
        orientation: 'row',
        weights: [1, 3.4],
        children: [
          { type: 'group', id: 'legacy-five-sidebar', panes: ['sessions', 'files'], active: 'sessions' },
          {
            type: 'group',
            id: 'legacy-five-terminal',
            panes: ['terminal-instance:deleted'],
            active: 'terminal-instance:deleted',
            emptyWorkspace: true
          }
        ]
      }
      localStorage.setItem('hermes.desktop.tabbedScreens.trees.v1', JSON.stringify(screens))
    })
    await page.reload()
    await waitForAppReady(fixture, 120_000)
    await page.getByRole('button', { name: 'Open Desktop five fixture', exact: true }).click()
    await expect(dot()).toHaveCount(0)
    await screen('5').click()
    await expect(page.locator('[data-empty-workspace]:visible')).toHaveCount(1)
    const filesButton = page.getByRole('button', { name: 'Show files', exact: true })

    if (await filesButton.isVisible()) {await filesButton.click()}

    const assertRails = async () => {
      const result = await page.evaluate(() => {
        interface Tree {
          id: string
          panes?: string[]
          children?: Tree[]
        }
        const tree: Tree = JSON.parse(localStorage.getItem('hermes.desktop.layoutTree.v2')!)
        const groups = (node: Tree): Tree[] => (node.panes ? [node] : (node.children ?? []).flatMap(groups))
        const nodes = groups(tree)
        const sessions = nodes.find(g => g.panes!.includes('sessions'))!
        const files = nodes.find(g => g.panes!.includes('files'))!

        const rect = (id: string) => {
          const r = document
            .querySelector(`[data-tabbed-screen="5"] [data-tree-group="${id}"]`)!
            .getBoundingClientRect()

          return { left: r.left, right: r.right, width: r.width }
        }

        return {
          sessions: sessions.panes,
          files: files.panes,
          left: rect(sessions.id),
          right: rect(files.id),
          panes: nodes.flatMap(g => g.panes!)
        }
      })

      expect(result.sessions).toEqual(['sessions'])
      expect(result.files).toEqual(['files'])
      expect(result.right.width).toBeGreaterThan(0)
      expect(result.right.left).toBeGreaterThan(result.left.right)
      expect(result.panes).not.toContain('terminal-instance:deleted')
    }

    await assertRails()
    await page.screenshot({ path: testInfo.outputPath('desktop-five-repaired.png') })

    await page.keyboard.press('Control+`')
    const tab = page.locator('[data-tree-tab^="terminal-instance:"]:visible')
    await expect(tab).toHaveCount(1)
    const paneId = (await tab.getAttribute('data-tree-tab'))!
    const id = paneId.slice('terminal-instance:'.length)
    await expect(page.locator(`[data-persistent-terminal="${id}"] .xterm`)).toBeVisible({ timeout: 30_000 })
    await expect(dot()).toHaveCount(1)
    await tab.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(tab).toHaveCount(0)
    await expect(dot()).toHaveCount(0)
    await screen('1').click()
    await page.getByRole('button', { name: 'All projects', exact: true }).click()
    const homeToggle = page.getByRole('button', { name: 'Show Home sessions', exact: true }).first()

    if (await homeToggle.isVisible()) {await homeToggle.click()}
    const row = page.locator(`[data-sidebar-terminal="${id}"]:visible`)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: /^Delete:/ }).click()
    await expect(page.locator(`[data-persistent-terminal="${id}"]`)).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(paneId => {
          const state = JSON.parse(localStorage.getItem('hermes.desktop.tabbedScreens.trees.v1')!)

          return JSON.stringify(state['5']).includes(paneId)
        }, paneId)
      )
      .toBe(false)
    await screen('5').click()
    await expect(dot()).toHaveCount(0)
    await expect(page.locator('[data-empty-workspace]:visible')).toHaveCount(1)
    await assertRails()
    await page.reload()
    await expect(screen('5')).toHaveAttribute('aria-pressed', 'true')
    await expect(dot()).toHaveCount(0)
    await assertRails()
    await page.screenshot({ path: testInfo.outputPath('desktop-five-after-terminal-delete.png') })
  } finally {
    await fixture.cleanup()
  }
})
