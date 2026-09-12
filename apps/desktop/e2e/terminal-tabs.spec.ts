import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { type MockBackendFixture, selectCreateAction, setupMockBackend, waitForAppReady } from './fixtures'
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
            params: { name: 'Terminal test', folders: [folder], color: '#e35d91' }
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

test('scroll windows show project-colored headers and working terminal cards', async ({}, testInfo) => {
  const { page } = fixture
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(2100, 900))
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await page.getByPlaceholder(/search/i).fill('scroll window')
  await page.mouse.move(8, 8)
  await page.locator('[data-slot="command-item"]').filter({ hasText: 'Toggle scroll-window layout' }).click()
  await page.keyboard.press('Escape')
  const project = page.locator('[data-sessions-project]').filter({
    has: page.getByRole('button', { name: 'Open Terminal test', exact: true })
  })
  await project.getByRole('button', { name: 'Open Terminal test', exact: true }).click()
  const chatHeader = page.locator('[data-scroll-window="workspace"] [data-scroll-window-header]')
  await expect(chatHeader).toHaveAttribute('data-scroll-window-project-color', '#e35d91')
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New terminal', exact: true }).click()
  const card = page.locator('[data-scroll-window^="terminal-instance:"]')
  await expect(card).toHaveCount(1)
  const id = (await card.getAttribute('data-scroll-window'))!.slice('terminal-instance:'.length)
  const header = card.locator('[data-scroll-window-header]')
  await expect(header).toHaveAttribute('data-scroll-window-project-color', '#e35d91')
  await expect.poll(() => header.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(
    await chatHeader.evaluate(el => getComputedStyle(el).backgroundColor)
  )
  const minimap = page.locator('[data-scroll-minimap]')
  await expect(minimap).toHaveCSS('border-top-width', '0px')
  await expect(minimap).not.toContainText('W1')
  for (const [windowId, icon] of [['workspace', 'comment'], [`terminal-instance:${id}`, 'terminal']]) {
    const mini = minimap.locator(`[data-scroll-minimap-window="${windowId}"]`)
    await expect(mini.locator(`.codicon-${icon}`)).toBeVisible()
    await expect.poll(() => mini.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(
      await header.evaluate(el => getComputedStyle(el).backgroundColor)
    )
  }
  const host = page.locator(`[data-persistent-terminal="${id}"]`)
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 30_000 })
  await host.locator('textarea').focus()
  await page.keyboard.type('export SCROLL_SHELL=alive; printf "CWD=%s\\n" "$PWD"')
  await page.keyboard.press('Enter')
  const buffer = () => page.evaluate(id => {
    const state = JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') ?? '{}')
    return state.terminals?.find((terminal: { id: string }) => terminal.id === id)?.reviveBuffer ?? ''
  }, id)
  await expect.poll(buffer).toMatch(/CWD=[^\r\n]*\/terminal-project/)
  await page.screenshot({ path: testInfo.outputPath('project-terminal-scroll.png') })

  const viewport = page.locator('[data-scroll-window-viewport]')
  await viewport.evaluate(el => { el.scrollLeft = 0 })
  const source = (await chatHeader.boundingBox())!
  const target = (await card.boundingBox())!
  await page.mouse.move(source.x + 80, source.y + 15)
  await page.mouse.down()
  await page.mouse.move(source.x + 100, source.y + 20, { steps: 6 })
  await page.mouse.move(target.x + target.width / 2, target.y + target.height - 20, { steps: 15 })
  await page.mouse.move(target.x + target.width / 2, target.y + target.height - 20, { steps: 2 })
  await expect(page.locator(`[data-scroll-drop-window="terminal-instance:${id}"] [data-scroll-drop-preview="bottom"]`)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('terminal-drop-preview.png') })
  await page.mouse.up()
  await expect.poll(async () => (await card.boundingBox())!.height).toBeLessThan(target.height * 0.6)
  await page.screenshot({ path: testInfo.outputPath('terminal-stack.png') })

  // A fixed xterm overlay must not paint or intercept input outside its scroll viewport.
  await selectCreateAction(page, 'New session')
  await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 900))
  await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth })
  await expect.poll(async () => host.evaluate(el => el.getBoundingClientRect().left)).toBeLessThan(600)
  const bounds = (await viewport.boundingBox())!
  await expect.poll(() => page.evaluate(({ x, y }) =>
    Boolean(document.elementFromPoint(x, y)?.closest('[data-persistent-terminal]')),
  { x: bounds.x - 8, y: bounds.y + bounds.height / 2 })).toBe(false)

  // Return from another virtual workspace via the existing sidebar terminal action.
  await page.getByRole('button', { name: 'Switch to workspace 2', exact: true }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole('button', { name: 'All projects', exact: true }).click()
  await page.locator(`[data-sidebar-terminal="${id}"] button[aria-pressed]`).click()
  await expect(card).toHaveCount(1)
  await expect(host.locator('.xterm')).toBeVisible()
  await host.locator('textarea').focus()
  await page.keyboard.type('printf "LIVE=%s\\n" "$SCROLL_SHELL"')
  await page.keyboard.press('Enter')
  await expect.poll(buffer).toContain('LIVE=alive')
  await card.getByRole('button', { name: 'Close window', exact: true }).click()
  await expect(card).toHaveCount(0)
  await expect(host).toHaveCount(0)
})

test('manual tabs retain shells while switching and stop and clear them on close', async () => {
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

  await expect(tabs).toHaveCount(2)
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

  // Assert OS process death, not only disappearance of the xterm host.
  const pidFile = path.join(fixture.sandbox.root, 'manual-shell.pid')
  const childPidFile = path.join(fixture.sandbox.root, 'manual-child.pid')
  await host.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type(`printf '%s' $$ > '${pidFile}'; sleep 120 & printf '%s' $! > '${childPidFile}'; wait`)
  await page.keyboard.press('Enter')
  await expect.poll(() => fs.existsSync(childPidFile) && fs.readFileSync(childPidFile, 'utf8').length > 0).toBe(true)
  const pids = [pidFile, childPidFile].map(file => Number(fs.readFileSync(file, 'utf8')))
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true } catch { return false }
  }
  expect(pids.every(pid => pid > 0 && alive(pid))).toBe(true)
  await page.locator(`[data-tree-tab="${firstPane}"]`).click({ button: 'middle' })
  await expect(host).toHaveCount(0)
  await expect(row).toHaveCount(0)
  await expect.poll(() => pids.map(alive), { timeout: 15_000 }).toEqual([false, false])
  expect(await page.evaluate(id => {
    const saved = JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') ?? '{}')
    return saved.terminals?.some((term: { id: string }) => term.id === id) ?? false
  }, id)).toBe(false)
  await page.screenshot({ path: 'test-results/terminal-closed-process-stopped.png' })

  // The remaining manual shell is removed via the sidebar deletion path.
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

test('agent process gets a connected sidebar child and opens its tab only on selection', async () => {
  const page = fixture.page
  await page.getByRole('button', { name: 'New session in Terminal test', exact: true }).click()
  const composer = page.locator('[contenteditable="true"]:visible').first()
  await composer.fill('E2E_SIDEBAR_CROSS')
  await page.keyboard.press('Enter')
  const tabs = page.locator('[data-tree-tab^="terminal-instance:"]')
  await expect(page.locator('[data-persistent-terminal][aria-hidden="false"]')).toHaveCount(0)
  await expect.poll(async () => {
    // Smart mode may request approval for this fixture's bounded shell loop.
    const run = page.getByRole('button', { name: /^Run(?:\s|$)/ }).first()
    if (await run.isVisible()) await run.click()
    return page.getByText('Both tasks are running in the background now.', { exact: true }).isVisible()
  }, { timeout: 30_000 }).toBe(true)
  await expect(tabs).toHaveCount(0)
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
  const expandChildren = page.getByRole('button', { name: 'Expand child chats', exact: true })

  if (await expandChildren.count()) {
    await expandChildren.first().click()
  }

  await expect(child).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-project-summary-kind="terminals"]')).toHaveCount(0)
  await expect(page.locator('[data-project-summary-kind="children"]')).toHaveCount(0)
  const stem = child.locator('[data-tree-stem]')
  await expect(stem).toBeVisible()
  await expect(stem).toHaveText(/[├└]─/)
  await expect(stem).toHaveAttribute('aria-hidden', 'true')
  const branchStem = page.locator('[data-session-project-dot] [data-tree-stem]').first()
  await expect(branchStem).toBeVisible()

  const stemStyle = (element: Element) => {
    const style = getComputedStyle(element)

    return { color: style.color, fontFamily: style.fontFamily, fontSize: style.fontSize }
  }

  expect(await stem.evaluate(stemStyle)).toEqual(await branchStem.evaluate(stemStyle))
  await expect(stem).toHaveText('├─')
  await expect(branchStem).toHaveText('└─')
  const terminalStemBox = (await stem.boundingBox())!
  const chatStemBox = (await branchStem.boundingBox())!
  await page.screenshot({ path: 'test-results/sidebar-child-alignment.png' })
  expect(Math.abs(terminalStemBox.x - chatStemBox.x)).toBeLessThan(1)
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
  // Opening a read-only child tab still must not count it as an interactive shell.
  await expect(page.locator('[data-project-summary-kind="terminals"]')).toHaveCount(0)
  const project = page
    .locator('[data-sessions-project]')
    .filter({ has: page.getByRole('button', { name: 'Open Terminal test', exact: true }) })
  await project.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New terminal', exact: true }).click()
  await expect(project.locator('[data-project-summary-kind="terminals"]')).toHaveText('1')
  await expect(page.locator('[data-project-summary-kind="children"]')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/terminal-chat-child.png' })
  const running = JSON.parse(fs.readFileSync(path.join(fixture.sandbox.hermesHome, 'processes.json'), 'utf8')) as { id: string; pid: number }[]
  expect(running.length).toBeGreaterThan(0)
  await page.evaluate(async () => {
    const w = window as typeof window & {
      hermesDesktop: { getConnection: () => Promise<{ wsUrl: string }> }
      archiveEvents?: unknown[]
      archiveObserver?: WebSocket
    }
    w.archiveEvents = []
    w.archiveObserver = new WebSocket((await w.hermesDesktop.getConnection()).wsUrl)
    w.archiveObserver.onmessage = event => {
      const frame = JSON.parse(String(event.data))
      if (frame.params?.payload?.archive_cleanup) w.archiveEvents!.push(frame.params.payload.archive_cleanup)
    }
    await new Promise<void>((resolve, reject) => {
      w.archiveObserver!.onopen = () => resolve()
      w.archiveObserver!.onerror = () => reject(new Error('Archive observer socket failed'))
    })
  })
  const owner = page.locator('[data-session-row-primary]').filter({ hasText: 'Terminal owner' }).first()
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " row-hover ")][1]')
  await owner.getByRole('button', { name: /^Archive/ }).click()
  await expect(host).toHaveCount(0)
  await expect(page.locator('[data-session-terminals] [data-sidebar-terminal]')).toHaveCount(0)
  await expect(tabs).toHaveCount(1) // the independent manual shell stays open
  await expect.poll(() => running.map(({ pid }) => {
    try { process.kill(pid, 0); return true } catch { return false }
  }), { timeout: 15_000 }).toEqual(running.map(() => false))
  await expect.poll(() => page.evaluate(() => (window as typeof window & { archiveEvents?: unknown[] }).archiveEvents?.length)).toBeGreaterThan(0)
  await page.screenshot({ path: 'test-results/archive-terminal-family-cleaned.png' })
})
