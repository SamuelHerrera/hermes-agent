import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

import { setupMockBackend, waitForAppReady } from './fixtures'

async function rpc<T = any>(page: Page, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return page.evaluate(({ method, params }) => new Promise((resolve, reject) => {
    const ws: WebSocket = (window as any).__spawnTestSocket
    const id = `spawn-e2e-${crypto.randomUUID()}`
    const timer = setTimeout(() => { ws.removeEventListener('message', receive); reject(new Error(`Timed out: ${method}`)) }, 30_000)
    function receive(event: MessageEvent) {
      const data = JSON.parse(String(event.data))
      if (data.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', receive)
      if (data.error) reject(new Error(JSON.stringify(data.error)))
      else resolve(data.result)
    }
    ws.addEventListener('message', receive)
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  }), { method, params }) as Promise<T>
}

const HANDOFF = 'E2E_PROJECT_SPAWN_INDEPENDENT: Return a short verification reply. Do not edit files.'

test('real session_spawn tool starts a durable independent project chat without UI input', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const args = { project: 'Spawn target', prompt: HANDOFF, title: 'Spawn verified chat', idempotency_key: 'desktop-e2e', open_tab: true }
  const fixture = await setupMockBackend({ mockServer: { sessionSpawnArgs: args, holdFirstStreamForPrompt: HANDOFF } })
  const { page } = fixture
  try {
    await waitForAppReady(fixture, 120_000)
    // Bind to the renderer's real, already-authorized socket. No fake gateway
    // or production test RPC is introduced, and no UI action starts a chat.
    await page.addInitScript(() => {
      const send = WebSocket.prototype.send
      WebSocket.prototype.send = function(data) {
        if (String(data).includes('jsonrpc')) (window as any).__spawnTestSocket = this
        return send.call(this, data)
      }
    })
    await page.reload()
    await waitForAppReady(fixture, 120_000)
    await page.waitForFunction(() => (window as any).__spawnTestSocket?.readyState === WebSocket.OPEN)
    const cwd = path.join(fixture.sandbox.root, 'spawn-target')
    fs.mkdirSync(cwd)
    execFileSync('git', ['init', '-b', 'spawn-branch', cwd])
    const { project } = await rpc(page, 'projects.create', { name: 'Spawn target', folders: [cwd], primary_path: cwd })
    // Draft setup only. No typing, keypress or click submits the caller or spawn.
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.fill('Unsent foreground draft must survive')
    const before = await page.evaluate(() => ({ hash: location.hash }))
    const caller = await rpc(page, 'session.create', { source: 'desktop', title: 'Spawn caller' })
    await rpc(page, 'prompt.submit', { session_id: caller.session_id, text: 'E2E_PROJECT_SPAWN_CALLER: invoke the requested tool exactly once.' })
    await fixture.mock.waitForHeldStream()
    const first = await rpc(page, 'session.spawn', { ...args, open_tab: undefined })
    expect(first.status).toBe('started')
    expect(first.replayed).toBe(true)
    expect(first.project.id).toBe(project.id)
    const repeat = await Promise.all(Array.from({ length: 4 }, () => rpc(page, 'session.spawn', args)))
    expect(new Set(repeat.map(result => result.session_id))).toEqual(new Set([first.session_id]))
    expect(fixture.mock.receivedPrompts.filter(prompt => prompt === HANDOFF)).toHaveLength(1)
    await expect(editor).toHaveText('Unsent foreground draft must survive')
    expect(await page.evaluate(() => location.hash)).toBe(before.hash)

    await expect(page.locator(`[data-pane-id="session-tile:${first.session_id}"]`).or(page.getByText('Spawn verified chat', { exact: true })).first()).toBeVisible({ timeout: 20_000 })
    const tree = await rpc(page, 'projects.tree', { preview_limit: 100 })
    const target = tree.projects.find((item: any) => item.id === project.id)
    expect(target.previewSessions[0].id).toBe(first.session_id)
    expect(target.previewSessions[0].cwd).toBe(cwd)
    expect(target.previewSessions[0].git_branch).toBe('spawn-branch')
    expect(target.previewSessions[0].parent_session_id).toBeFalsy()
    await expect(page.locator('[data-session-row-primary]').filter({ hasText: 'Spawn verified chat' }).first()).toBeVisible({ timeout: 20_000 })
    await rpc(page, 'session.interrupt', { session_id: caller.session_id })
    const active = await rpc(page, 'session.active_list')
    expect(JSON.stringify(active)).toContain(first.runtime_session_id)
    await page.screenshot({ path: testInfo.outputPath('independent-spawn-background-tab.png') })
    fixture.mock.releaseHeldStream()
    await expect.poll(async () => {
      const resumed = await rpc(page, 'session.resume', { session_id: first.session_id })
      return JSON.stringify(resumed.messages)
    }, { timeout: 30_000 }).toContain('Hello from the mock inference server')
    // Resolve the actual returned link into Desktop's session route, without a
    // UI click. Reference parser/navigation contracts have separate unit tests.
    expect(first.link).toBe(`@session:default/${first.session_id}`)
    await page.evaluate((id) => { location.hash = `#/${id}` }, first.session_id)
    await expect(page.getByText(HANDOFF, { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    const resumed = await rpc(page, 'session.resume', { session_id: first.session_id })
    expect(resumed.messages.filter((message: any) => JSON.stringify(message).includes(HANDOFF))).toHaveLength(1)
    const persisted = JSON.parse(execFileSync('python3', ['-c',
      'import sqlite3,json,sys; c=sqlite3.connect("file:"+sys.argv[1]+"/state.db?mode=ro",uri=True); c.row_factory=sqlite3.Row; r=dict(c.execute("select id,cwd,git_branch,profile_name,parent_session_id from sessions where id=?",(sys.argv[2],)).fetchone()); r["prompt_count"]=c.execute("select count(*) from messages where session_id=? and role=\'user\' and content=?",(sys.argv[2],sys.argv[3])).fetchone()[0]; p=sqlite3.connect("file:"+sys.argv[1]+"/projects.db?mode=ro",uri=True); r["project_id"]=p.execute("select project_id from session_spawns where session_id=?",(sys.argv[2],)).fetchone()[0]; print(json.dumps(r))',
      fixture.sandbox.hermesHome, first.session_id, HANDOFF
    ], { encoding: 'utf8' }))
    // The ordinary default-profile writer canonicalizes its optional SQL
    // profile_name to NULL; the durable spawn receipt names it explicitly.
    expect(first.profile).toBe('default')
    expect(persisted).toMatchObject({ id: first.session_id, cwd, git_branch: 'spawn-branch', profile_name: null, parent_session_id: null, prompt_count: 1, project_id: project.id })
    await testInfo.attach('persisted-spawn-receipt', { body: JSON.stringify({ result: first, persisted }, null, 2), contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath('independent-spawn-link-opened.png') })
  } finally {
    fixture.mock.releaseHeldStream()
    await fixture.cleanup()
  }
})
