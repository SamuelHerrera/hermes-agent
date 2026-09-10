import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { createBackgroundReleaseHandle } from './mock-server'
import { expect, test } from './test'

let fixture: MockBackendFixture
let release: ReturnType<typeof createBackgroundReleaseHandle>

test.beforeEach(async () => {
  release = createBackgroundReleaseHandle()
  fixture = await setupMockBackend({
    mockServer: { backgroundReleasePath: release.path },
    extraConfig: 'auxiliary:\n  title_generation:\n    enabled: false\nterminal:\n  cwd: /tmp\n'
  })
  await waitForAppReady(fixture, 120_000)
  const folder = path.join(fixture.sandbox.root, 'terminal-project')
  fs.mkdirSync(folder)
  await fixture.page.evaluate(async folder => {
    const desktop = (window as typeof window & { hermesDesktop: { getConnection: () => Promise<{ wsUrl: string }> } })
      .hermesDesktop

    const { wsUrl } = await desktop.getConnection()
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl!)

      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('Project creation timed out'))
      }, 15000)

      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'projects.create',
            params: { name: 'Terminal test', folders: [folder] }
          })
        )

      ws.onmessage = event => {
        const result = JSON.parse(String(event.data))

        if (result.id !== 1) {
          return
        }

        clearTimeout(timer)
        ws.close()

        if (result.error) {
          reject(new Error(JSON.stringify(result.error)))
        } else {
          resolve()
        }
      }
    })
  }, folder)
  await fixture.page.reload()
  await waitForAppReady(fixture, 120_000)
})
test.afterEach(async () => {
  release.release()

  await fixture?.cleanup()
  release.cleanup()
})

test('manual shells occupy individual top-level tabs and reopen without losing the live shell', async () => {
  const page = fixture.page
  await page.keyboard.press('Control+`')
  const tabs = page.locator('[data-tree-tab^="terminal-instance:"]')
  await expect(tabs).toHaveCount(1)
  const firstPane = await tabs.first().getAttribute('data-tree-tab')
  const id = firstPane!.replace('terminal-instance:', '')
  const host = page.locator(`[data-persistent-terminal="${id}"]`)
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 30_000 })
  await host.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('export HERMES_TERMINAL_TAB_TEST=still_alive')
  await page.keyboard.press('Enter')

  const project = page
    .locator('[data-sessions-project]')
    .filter({ has: page.getByRole('button', { name: 'Open Terminal test', exact: true }) })

  await project.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New terminal', exact: true }).click()
  await expect(tabs).toHaveCount(2)
  await expect(page.locator('[data-persistent-terminal][aria-hidden="false"] .xterm')).toBeVisible()
  const projectPane = (await tabs.nth(1).getAttribute('data-tree-tab'))!
  const projectId = projectPane.slice('terminal-instance:'.length)
  await page.locator(`[data-persistent-terminal="${projectId}"] textarea`).focus()
  await page.keyboard.type('printf "CWD=%s\\n" "$PWD"')
  await page.keyboard.press('Enter')
  await expect
    .poll(() =>
      page.evaluate(id => {
        const saved = JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') || '{}')

        return saved.terminals?.find((terminal: { id: string }) => terminal.id === id)?.reviveBuffer ?? ''
      }, projectId)
    )
    .toMatch(/CWD=[^\r\n]*\/terminal-project/)
  await expect(page.locator('[role="tablist"][aria-label="Terminals"]')).toHaveCount(0)

  await page.locator(`[data-tree-tab="${firstPane}"]`).click({ button: 'middle' })
  await expect(tabs).toHaveCount(1)
  await expect(host).toHaveAttribute('aria-hidden', 'true')

  const homeToggle = page.getByRole('button', { name: 'Show Home sessions', exact: true }).first()

  if (await homeToggle.count()) {
    await homeToggle.click()
  }

  const row = page.locator(`[data-sidebar-terminal="${id}"]`)
  await expect(row).toBeVisible()
  await expect(row.locator('button[aria-pressed]')).toHaveAttribute('aria-pressed', 'false')
  await row.hover()
  await expect.poll(() => row.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await row.locator('button').filter({ hasText: /.+/ }).first().click()
  await expect(tabs).toHaveCount(2)
  await expect(host).toHaveAttribute('aria-hidden', 'false')
  await expect(row.locator('button[aria-pressed]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator(`[data-tree-tab="${projectPane}"]`).click()
  await expect(row.locator('button[aria-pressed]')).toHaveAttribute('aria-pressed', 'false')
  await page.locator(`[data-tree-tab="${firstPane}"]`).click()
  await expect(row.locator('button[aria-pressed]')).toHaveAttribute('aria-pressed', 'true')
  await host.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('printf "LIVE=%s\\n" "$HERMES_TERMINAL_TAB_TEST"')
  await page.keyboard.press('Enter')
  await expect
    .poll(() =>
      page.evaluate(terminalId => {
        const state = JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') ?? '{}')

        return state.terminals?.find((terminal: { id: string }) => terminal.id === terminalId)?.reviveBuffer ?? ''
      }, id)
    )
    .toContain('LIVE=still_alive')
  await page.screenshot({ path: 'test-results/terminal-individual-tabs.png' })

  // A real foreground process, without OSC shell integration, drives both labels.
  const shellTitle = await row.locator('button[aria-pressed]').innerText()
  await host.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('sleep 60')
  await page.keyboard.press('Enter')
  await expect(row).toContainText('sleep')
  await expect(page.locator(`[data-tree-tab="${firstPane}"]`)).toContainText('sleep')
  await row.hover()
  await page.screenshot({ path: 'test-results/terminal-process-hover.png' })
  await host.locator('.xterm-helper-textarea').focus()
  await page.keyboard.press('Control+c')
  await expect(row.locator('button[aria-pressed]')).toHaveText(shellTitle)
  await expect(project.locator('[data-project-summary-kind="terminals"]')).toHaveText('1')

  // Remove our manual shells, not merely their views, before the agent case.
  const deletes = page.locator('[data-sidebar-terminal] button[aria-label^="Delete:"]')

  while (await deletes.count()) {
    await deletes.first().click()
  }

  await expect(tabs).toHaveCount(0)
})

test('project chats support durable drag ordering and new chats prepend', async () => {
  const page = fixture.page

  const seed = (names: string[]) =>
    execFileSync(
      process.env.HERMES_DESKTOP_PYTHON || 'python3',
      [
        '-c',
        `
import json, sys
from pathlib import Path
from hermes_state import SessionDB
db = SessionDB(Path(sys.argv[1]) / 'state.db')
for name in json.loads(sys.argv[3]):
    sid = 'sidebar-order-' + name
    db.create_session(sid, 'gui', cwd=sys.argv[2], profile_name='default')
    db.set_session_title(sid, 'Order ' + name)
    db.append_message(sid, 'user', 'Seeded sidebar ordering fixture')
db.close()
`,
        fixture.sandbox.hermesHome,
        path.join(fixture.sandbox.root, 'terminal-project'),
        JSON.stringify(names)
      ],
      {
        cwd: path.resolve(import.meta.dirname, '../../..'),
        env: { ...process.env, HERMES_HOME: fixture.sandbox.hermesHome },
        timeout: 15000
      }
    )

  const orderRows = page.locator('[data-session-row-primary]').filter({ hasText: /Order [A-D]/ })
  const order = () => orderRows.allTextContents().then(rows => rows.map(row => row.trim()))
  seed(['A', 'B', 'C'])
  await page.reload()
  await waitForAppReady(fixture)
  await expect.poll(order).toEqual(['Order C', 'Order B', 'Order A'])
  const handle = page.getByRole('button', { name: 'Reorder Order A', exact: true })
  const from = (await handle.boundingBox())!
  const to = (await page.getByRole('button', { name: 'Reorder Order C', exact: true }).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(order).toEqual(['Order A', 'Order C', 'Order B'])
  await page.reload()
  await waitForAppReady(fixture)
  await expect.poll(order).toEqual(['Order A', 'Order C', 'Order B'])
  seed(['D'])
  await page.reload()
  await waitForAppReady(fixture)
  await expect.poll(order).toEqual(['Order D', 'Order A', 'Order C', 'Order B'])

  const project = page.locator('[data-sessions-project]').filter({ has: page.getByRole('button', { name: 'Open Terminal test', exact: true }) })
  await project.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New terminal', exact: true }).click()
  const tab = page.locator('[data-tree-tab^="terminal-instance:"]').last()
  const paneId = (await tab.getAttribute('data-tree-tab'))!
  const terminalRow = page.locator(`[data-sidebar-terminal="${paneId.slice('terminal-instance:'.length)}"]`)

  const chatRow = orderRows
    .last()
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " row-hover ")][1]')

  await orderRows.first().click()
  await expect(terminalRow.locator('button[aria-pressed]')).toHaveAttribute('aria-pressed', 'false')
  await page.locator(`[data-tree-tab="${paneId}"]`).click()
  await expect(terminalRow.locator('button[aria-pressed]')).toHaveAttribute('aria-pressed', 'true')
  await chatRow.hover()
  const chatHover = await chatRow.evaluate(el => getComputedStyle(el).backgroundColor)
  await terminalRow.hover()
  expect(await terminalRow.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(chatHover)
  const chatBox = (await chatRow.boundingBox())!
  const terminalBox = (await terminalRow.boundingBox())!
  expect(Math.abs(terminalBox.x - chatBox.x)).toBeLessThan(1)
  expect(Math.abs(terminalBox.width - chatBox.width)).toBeLessThan(1)
  expect(terminalBox.y - chatBox.y - chatBox.height).toBeLessThanOrEqual(2)
  await page.screenshot({ path: 'test-results/sidebar-order-hover-selection.png' })
  await terminalRow.getByRole('button', { name: /^Delete:/ }).click()
})

test('agent process gets its own tab and a sidebar child under its chat without taking focus', async () => {
  const page = fixture.page
  await page.getByRole('button', { name: 'New session in Terminal test', exact: true }).click()
  const composer = page.locator('[contenteditable="true"]:visible').first()
  await composer.fill('E2E_SIDEBAR_CROSS')
  await page.keyboard.press('Enter')
  const tabs = page.locator('[data-tree-tab^="terminal-instance:"]')
  await expect(tabs).toHaveCount(1, { timeout: 60_000 })
  await expect(page.locator('[data-persistent-terminal][aria-hidden="false"]')).toHaveCount(0)
  await expect(page.getByText('Both tasks are running in the background now.', { exact: true })).toBeVisible({
    timeout: 30_000
  })
  await composer.fill('/title Terminal owner')
  await page.keyboard.press('Enter')
  // Rehydrate the authoritative project overview and the still-running process.
  await page.reload()
  await waitForAppReady(fixture)
  const homeToggle = page.getByRole('button', { name: 'Show Home sessions', exact: true })

  if (await homeToggle.count()) {
    await homeToggle.click()
  }

  const child = page.locator('[data-session-terminals] [data-sidebar-terminal]').first()
  await expect(child).toBeVisible({ timeout: 5_000 })
  const id = await child.getAttribute('data-sidebar-terminal')
  await child.locator('button').filter({ hasText: /.+/ }).first().click()
  const host = page.locator(`[data-persistent-terminal="${id}"]`)
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 30_000 })
  await page.locator(`[data-tree-tab="terminal-instance:${id}"]`).click({ button: 'middle' })
  await expect(tabs).toHaveCount(0)
  await expect(child).toBeVisible()
  await child.locator('button').filter({ hasText: /.+/ }).first().click()
  await expect(tabs).toHaveCount(1)
  await expect(host.locator('.xterm')).toBeVisible()
  await page.screenshot({ path: 'test-results/terminal-chat-child.png' })
})
