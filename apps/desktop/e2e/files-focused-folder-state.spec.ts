import fs from 'node:fs'
import path from 'node:path'

import type { Page } from '@playwright/test'

import { setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

// Observe the app's authenticated socket; all setup goes through ordinary backend
// handlers. No renderer stores, file listings, session rows or view state are faked.
async function rpc<T>(page: Page, method: string, params: Record<string, unknown>): Promise<T> {
  return page.evaluate(
    ({ method, params }) =>
      new Promise((resolve, reject) => {
        const ws = (window as typeof window & { __filesTestSocket: WebSocket }).__filesTestSocket
        const id = `files-e2e-${crypto.randomUUID()}`

        const timer = setTimeout(() => {
          ws.removeEventListener('message', receive)
          reject(new Error(`Timed out: ${method}`))
        }, 30_000)

        function receive(event: MessageEvent) {
          const data = JSON.parse(String(event.data))

          if (data.id !== id) {
            return
          }
          clearTimeout(timer)
          ws.removeEventListener('message', receive)

          if (data.error) {
            reject(new Error(JSON.stringify(data.error)))
          } else {
            resolve(data.result)
          }
        }

        ws.addEventListener('message', receive)
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      }),
    { method, params }
  ) as Promise<T>
}

function populate(root: string) {
  for (const folder of ['00-open', '01-closed']) {
    const nested = path.join(root, folder, '00-nested')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, 'nested-proof.txt'), `Real file under ${root}\n`)

    for (let i = 0; i < 90; i++) {
      fs.writeFileSync(path.join(root, folder, `file-${String(i).padStart(3, '0')}.txt`), `${i}\n`)
    }
  }

  fs.writeFileSync(path.join(root, `${path.basename(root)}-proof.txt`), 'Root identity marker\n')
}

async function scrollTop(page: Page): Promise<number> {
  return page.locator('[data-project-tree]:visible').evaluate(tree => {
    const scroller = [...tree.querySelectorAll<HTMLElement>('*')].find(
      node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight
    )

    if (!scroller) {
      throw new Error('Real arborist scroll viewport not found')
    }

    return scroller.scrollTop
  })
}

async function wheel(page: Page, deltaY: number) {
  await page.locator('[data-project-tree]:visible').hover()
  await page.mouse.wheel(0, deltaY)
}

// eslint-disable-next-line no-empty-pattern -- Electron supplies its own page.
test('Files follows existing focused chat tabs and restores each folder expansion and scroll', async ({}, testInfo) => {
  test.setTimeout(240_000)
  const fixture = await setupMockBackend()
  const { page } = fixture

  try {
    await waitForAppReady(fixture, 120_000)
    await page.addInitScript(() => {
      const send = WebSocket.prototype.send

      WebSocket.prototype.send = function (data) {
        if (String(data).includes('jsonrpc')) {
          ;(window as typeof window & { __filesTestSocket: WebSocket }).__filesTestSocket = this
        }

        return send.call(this, data)
      }
    })
    await page.reload()
    await waitForAppReady(fixture, 120_000)
    await page.waitForFunction(
      () =>
        (window as typeof window & { __filesTestSocket?: WebSocket }).__filesTestSocket?.readyState === WebSocket.OPEN
    )

    const roots = ['files-alpha', 'files-beta'].map(name => path.join(fixture.sandbox.root, name))
    const sessions: string[] = []

    for (const root of roots) {
      populate(root)
      const name = path.basename(root)
      await rpc(page, 'projects.create', { name, folders: [root], primary_path: root })

      const spawned = await rpc<{ session_id: string }>(page, 'session.spawn', {
        project: name,
        title: name,
        prompt: `Reply briefly for ${name}. Do not use tools.`,
        open_tab: false
      })

      sessions.push(spawned.session_id)
      await page
        .locator('[data-session-row-primary]')
        .filter({ hasText: name })
        .first()
        .click({ modifiers: ['ControlOrMeta'] })
      await expect(page.locator(`[data-tree-tab="session-tile:${spawned.session_id}"]:visible`)).toBeVisible({
        timeout: 30_000
      })
    }

    await page.locator(`[data-tree-tab="session-tile:${sessions[0]}"]:visible`).click()
    await page.getByRole('button', { name: 'Show files', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Right sidebar' })).toBeVisible()

    const tree = page.locator('[data-project-tree]:visible')
    const row = (root: string, relative: string) => tree.locator(`[title=${JSON.stringify(path.join(root, relative))}]`)

    const focus = async (index: number) => {
      // This is the regression: click a tab that is ALREADY open, not a sidebar
      // session row, route navigation, project switch or programmatic store write.
      await page.locator(`[data-tree-tab="session-tile:${sessions[index]}"]:visible`).click()
      await expect(page.locator('aside').filter({ has: tree })).toContainText(path.basename(roots[index]))
      await expect(tree.locator('[title]').first()).toHaveAttribute(
        'title',
        new RegExp(roots[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      )
    }

    await focus(0)
    await row(roots[0], '00-open').click()
    await expect(row(roots[0], '00-open/00-nested')).toBeVisible()
    await row(roots[0], '00-open/00-nested').click()
    await expect(row(roots[0], '00-open/00-nested/nested-proof.txt')).toBeVisible()
    await expect(row(roots[0], '00-open')).toHaveAttribute('aria-expanded', 'true')
    await wheel(page, 550)
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(400)
    const alphaScroll = await scrollTop(page)
    await page.screenshot({ path: testInfo.outputPath('alpha-expanded-scrolled.png') })

    await focus(1)
    await expect(row(roots[1], '00-open')).toHaveAttribute('aria-expanded', 'false')
    // Explicitly open then collapse the same-named directory, rather than only
    // relying on an untouched default-closed folder.
    await row(roots[1], '00-open').click()
    await expect(row(roots[1], '00-open/00-nested')).toBeVisible()
    await row(roots[1], '00-open').click()
    await expect(row(roots[1], '00-open')).toHaveAttribute('aria-expanded', 'false')
    await row(roots[1], '01-closed').click()
    await expect(row(roots[1], '01-closed/00-nested')).toBeVisible()
    await wheel(page, 950)
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(800)
    const betaScroll = await scrollTop(page)
    expect(Math.abs(alphaScroll - betaScroll)).toBeGreaterThan(200)

    // Revisit both roots repeatedly, without touching tree data or stored state.
    for (let round = 0; round < 2; round++) {
      await focus(0)
      await expect.poll(async () => Math.abs((await scrollTop(page)) - alphaScroll)).toBeLessThanOrEqual(2)
      await page.screenshot({ path: testInfo.outputPath(`alpha-restored-${round}.png`) })
      await focus(1)
      await expect.poll(async () => Math.abs((await scrollTop(page)) - betaScroll)).toBeLessThanOrEqual(2)
      await page.screenshot({ path: testInfo.outputPath(`beta-restored-${round}.png`) })
    }

    await wheel(page, -10_000)
    await expect.poll(() => scrollTop(page)).toBe(0)
    await expect(row(roots[1], '00-open')).toHaveAttribute('aria-expanded', 'false')
    await expect(row(roots[1], '01-closed')).toHaveAttribute('aria-expanded', 'true')
    await expect(row(roots[1], '01-closed/00-nested')).toHaveAttribute('aria-expanded', 'false')
    await page.screenshot({ path: testInfo.outputPath('beta-independent-expansion.png') })
    await focus(0)
    await expect.poll(async () => Math.abs((await scrollTop(page)) - alphaScroll)).toBeLessThanOrEqual(2)
    await wheel(page, -10_000)
    await expect.poll(() => scrollTop(page)).toBe(0)
    await expect(row(roots[0], '00-open')).toHaveAttribute('aria-expanded', 'true')
    await expect(row(roots[0], '00-open/00-nested')).toHaveAttribute('aria-expanded', 'true')
    await expect(row(roots[0], '00-open/00-nested/nested-proof.txt')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('alpha-nested-expansion-restored.png') })

    await wheel(page, 550)
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(400)
    const reloadScroll = await scrollTop(page)

    // Persisted state must survive a renderer restart, not only component reuse.
    await page.reload()
    await waitForAppReady(fixture, 120_000)
    await focus(0)
    await expect.poll(async () => Math.abs((await scrollTop(page)) - reloadScroll)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: testInfo.outputPath('alpha-scroll-after-reload.png') })
    await wheel(page, -10_000)
    await expect.poll(() => scrollTop(page)).toBe(0)
    await expect(row(roots[0], '00-open/00-nested')).toHaveAttribute('aria-expanded', 'true')
    await focus(1)
    await expect.poll(() => scrollTop(page)).toBe(0)
    await expect(row(roots[1], '00-open')).toHaveAttribute('aria-expanded', 'false')
    await expect(row(roots[1], '01-closed')).toHaveAttribute('aria-expanded', 'true')
    await page.screenshot({ path: testInfo.outputPath('beta-expansion-after-reload.png') })
    await testInfo.attach('folder-state-receipt', {
      body: JSON.stringify({ roots, sessions, alphaScroll, betaScroll }, null, 2),
      contentType: 'application/json'
    })
  } catch (error) {
    await testInfo.attach('files-failure-dom', {
      body: await page.locator('body').innerText(),
      contentType: 'text/plain'
    })
    await testInfo.attach('files-failure-layout', {
      body: JSON.stringify(
        await page.evaluate(() => ({
          storage: Object.fromEntries(
            Object.entries(localStorage).filter(([key]) => /layout|pane|files|window/i.test(key))
          ),
          groups: [...document.querySelectorAll('[data-tree-group],aside')].map(node => ({
            tag: node.tagName,
            group: node.getAttribute('data-tree-group'),
            box: node.getBoundingClientRect().toJSON()
          }))
        })),
        null,
        2
      ),
      contentType: 'application/json'
    })
    await page.screenshot({ path: testInfo.outputPath('files-failure.png') }).catch(() => {})
    throw error
  } finally {
    await fixture.cleanup()
  }
})
