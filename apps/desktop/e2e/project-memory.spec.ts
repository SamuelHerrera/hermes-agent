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
  } finally {
    await fixture.cleanup()
  }
})
