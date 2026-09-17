import { expect, test, type Page } from '@playwright/test'

import { buildAppEnv, launchDesktop, setupMockBackend, waitForAppReady } from './fixtures'

async function bindSocket(page: Page) {
  await page.addInitScript(() => {
    const send = WebSocket.prototype.send
    WebSocket.prototype.send = function(data) {
      if (String(data).includes('jsonrpc')) (window as any).__questionsSocket = this
      return send.call(this, data)
    }
  })
  await page.reload()
  await page.waitForFunction(() => (window as any).__questionsSocket?.readyState === WebSocket.OPEN)
}

async function rpc(page: Page, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return page.evaluate(({ method, params }) => new Promise((resolve, reject) => {
    const ws = (window as any).__questionsSocket as WebSocket
    const id = crypto.randomUUID()
    const timer = setTimeout(() => { ws.removeEventListener('message', receive); reject(new Error(method)) }, 30_000)
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
  }), { method, params })
}

async function openInbox(page: Page) {
  await page.getByRole('button', { name: 'More app actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Views', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Questions', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Questions', exact: true })).toBeVisible()
}

test('durable question inbox survives restart, accumulates, and resumes a late answer', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = await setupMockBackend({ extraConfig: 'agent:\n  clarify_timeout: 0\n  clarify_soft_timeout: 1\n  clarify_review_timeout: 2' })
  let desktop = { app: fixture.app, page: fixture.page }
  try {
    await waitForAppReady(fixture, 120_000)
    await bindSocket(desktop.page)
    await waitForAppReady({ ...fixture, ...desktop }, 120_000)
    const created = await rpc(desktop.page, 'session.create', { source: 'desktop', title: 'Durable questions test' })
    await rpc(desktop.page, 'prompt.submit', { session_id: created.session_id, text: 'E2E_DURABLE_QUESTIONS: ask both questions, then continue independent work.' })
    await expect.poll(async () => (await rpc(desktop.page, 'questions.list')).questions.length, { timeout: 40_000 }).toBe(2)
    const before = (await rpc(desktop.page, 'questions.list')).questions
    await expect.poll(async () => JSON.stringify((await rpc(desktop.page, 'session.resume', { session_id: before[0].session_id })).messages), { timeout: 30_000 })
      .toContain('Question inbox fixture completed independent work.')
    expect(before.map((row: any) => row.status)).toEqual(['open', 'open'])
    expect(before.map((row: any) => row.requires_user)).toEqual([true, false])
    await openInbox(desktop.page)
    await expect(desktop.page.getByRole('article')).toHaveCount(2)
    await desktop.page.screenshot({ path: testInfo.outputPath('questions-accumulated.png'), fullPage: true })

    await desktop.app.close()
    desktop = await launchDesktop(buildAppEnv(fixture.sandbox))
    await waitForAppReady({ ...fixture, ...desktop }, 120_000)
    await bindSocket(desktop.page)
    await waitForAppReady({ ...fixture, ...desktop }, 120_000)
    const after = (await rpc(desktop.page, 'questions.list')).questions
    expect(after.map((row: any) => row.id)).toEqual(before.map((row: any) => row.id))
    if (!await desktop.page.getByRole('heading', { name: 'Questions', exact: true }).isVisible()) await openInbox(desktop.page)
    await expect(desktop.page.getByRole('article')).toHaveCount(2)
    const hard = desktop.page.getByRole('article').filter({ hasText: 'Which release needs your approval?' })
    await hard.getByLabel('Release B', { exact: true }).check()
    await hard.getByRole('button', { name: 'Answer and continue' }).click()
    await expect(desktop.page.getByRole('article')).toHaveCount(1)
    await expect.poll(async () => (await rpc(desktop.page, 'session.resume', { session_id: before[0].session_id }))
      .messages.filter((message: any) => message.role === 'user').map((message: any) => message.text).join('\n'), { timeout: 30_000 })
      .toContain('Answer: "Release B"')
    const history = (await rpc(desktop.page, 'questions.list', { include_answered: true })).questions
    expect(history[0].answered_by).toBe('user')
    expect(history[0].answer).toBe('Release B')
    expect(history[1].status).toBe('open')
    await desktop.page.getByText('Question settings', { exact: true }).click()
    await desktop.page.getByLabel('Soft review delay in seconds, 0 disables').fill('0')
    await desktop.page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => (await rpc(desktop.page, 'questions.list')).settings.clarify_soft_timeout).toBe(0)
    await desktop.page.screenshot({ path: testInfo.outputPath('questions-answered-settings.png'), fullPage: true })
  } finally {
    await desktop.app.close().catch(() => undefined)
    await fixture.cleanup()
  }
})
