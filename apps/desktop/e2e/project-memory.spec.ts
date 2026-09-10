import fs from 'node:fs'
import path from 'node:path'

import type { Page } from '@playwright/test'

import { setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

// Each request uses a separate socket, proving persistence is shared between
// clients rather than held in one renderer or gateway connection.
async function rpc<T>(page: Page, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return page.evaluate(
    async ({ method, params }) => {
      const desktop = (
        window as typeof window & {
          hermesDesktop: { getConnection: () => Promise<{ wsUrl: string }> }
        }
      ).hermesDesktop
      const { wsUrl } = await desktop.getConnection()
      return new Promise<T>((resolve, reject) => {
        const ws = new WebSocket(wsUrl)
        const timer = setTimeout(() => {
          ws.close()
          reject(new Error(`Timed out: ${method}`))
        }, 15000)
        ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }))
        ws.onmessage = event => {
          const response = JSON.parse(String(event.data))
          if (response.id !== 1) return
          clearTimeout(timer)
          ws.close()
          if (response.error) reject(new Error(JSON.stringify(response.error)))
          else resolve(response.result)
        }
        ws.onerror = () => {
          clearTimeout(timer)
          ws.close()
          reject(new Error(`Socket failed: ${method}`))
        }
      })
    },
    { method, params }
  )
}

interface Project {
  id: string
  name: string
  icon: string | null
  color: string | null
  folders: { path: string }[]
}

test('project removal remembers settings across clients and the simplified create form restores them', async ({}, testInfo) => {
  const fixture = await setupMockBackend()
  try {
    await waitForAppReady(fixture)
    const folder = path.join(fixture.sandbox.root, 'workspace')
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, 'IDEA.md'), 'Existing user document\n')
    const original = await rpc<{ project: Project }>(fixture.page, 'projects.create', {
      name: 'Original workspace',
      folders: [folder],
      icon: 'rocket',
      color: '#12a594',
      use: true
    })
    await rpc(fixture.page, 'projects.delete', { id: original.project.id })
    const removed = await rpc<{ projects: Project[]; active_id: string | null }>(fixture.page, 'projects.list')
    expect(removed.projects.some(p => p.id === original.project.id)).toBe(false)
    expect(removed.active_id).toBeNull()

    // Only the native folder selection is stubbed; form submission, IPC,
    // WebSocket RPC, SQLite and the refreshed renderer all run for real.
    await fixture.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, folder)
    await fixture.page.reload()
    await waitForAppReady(fixture)
    await fixture.page.getByRole('button', { name: 'New project', exact: true }).click()
    const form = fixture.page.getByRole('dialog')
    await expect(form.getByRole('textbox')).toHaveCount(1)
    await expect(form.getByText('Idea', { exact: true })).toHaveCount(0)
    await form.getByRole('textbox').fill('Renamed workspace')
    await form.getByRole('button', { name: 'Add folder', exact: true }).click()
    await expect(form.getByText(folder, { exact: true })).toBeVisible()
    const recents = fixture.page.getByRole('region', { name: 'Recently opened' })
    await expect(recents).toBeVisible()
    // Resize the real window; history goes left on wide windows, below on narrow ones.
    for (const width of [1200, 650]) {
      await fixture.app.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(400, 400)
        window.setSize(width, 850)
      }, width)
      await expect
        .poll(async () => {
          const list = (await recents.boundingBox())!
          const input = (await form.getByRole('textbox').boundingBox())!
          return width === 1200 ? list.x + list.width <= input.x : list.y > input.y + input.height
        })
        .toBe(true)
      await fixture.page.screenshot({ path: testInfo.outputPath(`recent-projects-${width}.png`) })
      const overflow = await form.evaluate(el =>
        Array.from(el.querySelectorAll('*')).some(
          node =>
            node.clientWidth > 0 &&
            node.scrollWidth > node.clientWidth + 1 &&
            getComputedStyle(node).overflowX === 'auto'
        )
      )
      expect(overflow).toBe(false)
    }
    await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 850))
    const dialogBounds = await form.boundingBox()
    const createBounds = await form.getByRole('button', { name: 'Create', exact: true }).boundingBox()
    expect(createBounds!.x + createBounds!.width).toBeLessThanOrEqual(dialogBounds!.x + dialogBounds!.width)
    await fixture.page.screenshot({ path: testInfo.outputPath('project-form.png') })
    await form.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(form).toHaveCount(0)
    const restored = await rpc<{ project: Project }>(fixture.page, 'projects.get', { id: original.project.id })
    expect(restored.project.name).toBe('Renamed workspace')
    expect(restored.project.icon).toBe(original.project.icon)
    expect(restored.project.color).toBe(original.project.color)
    expect(restored.project.folders.map(f => f.path)).toEqual([folder])
    expect(fs.readFileSync(path.join(folder, 'IDEA.md'), 'utf8')).toBe('Existing user document\n')
    await expect(fixture.page.getByText('Renamed workspace', { exact: true }).first()).toBeVisible()
    await fixture.page.screenshot({ path: testInfo.outputPath('restored-project.png') })
    await fixture.page.getByRole('button', { name: 'New project', exact: true }).click()
    await expect(recents).toHaveCount(0)
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await rpc(fixture.page, 'projects.delete', { id: original.project.id })
    await fixture.page.reload()
    await waitForAppReady(fixture)
    await fixture.page.getByRole('button', { name: 'New project', exact: true }).click()
    await expect(recents.getByText('Renamed workspace', { exact: true })).toBeVisible()
    await fixture.page.screenshot({ path: testInfo.outputPath('recent-projects.png') })
    await recents.getByRole('button', { name: 'Remove from recent projects: Renamed workspace', exact: true }).click()
    await expect(recents).toHaveCount(0)
    // Forgetting history is durable across fresh clients and dialog mounts.
    await fixture.page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await fixture.page.reload()
    await waitForAppReady(fixture)
    await fixture.page.getByRole('button', { name: 'New project', exact: true }).click()
    await expect(recents).toHaveCount(0)
    await fixture.page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    const kept = await rpc<{ project: Project }>(fixture.page, 'projects.create', {
      name: 'Renamed workspace',
      folders: [folder],
      use: true
    })
    expect(kept.project.id).toBe(original.project.id)
    expect(kept.project.icon).toBe(original.project.icon)
    expect(kept.project.color).toBe(original.project.color)
    await rpc(fixture.page, 'projects.delete', { id: original.project.id })
    await fixture.page.reload()
    await waitForAppReady(fixture)
    await fixture.page.getByRole('button', { name: 'New project', exact: true }).click()
    await recents.getByRole('button', { name: 'Open project: Renamed workspace', exact: true }).click()
    await expect(fixture.page.getByRole('dialog')).toHaveCount(0)
    const reopened = await rpc<{ project: Project }>(fixture.page, 'projects.get', { id: original.project.id })
    expect(reopened.project).toMatchObject({
      id: original.project.id,
      icon: original.project.icon,
      color: original.project.color
    })
  } finally {
    await fixture.cleanup()
  }
})
