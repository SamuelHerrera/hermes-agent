import { expect, test } from './test'
import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'

let fixture: MockBackendFixture

interface TerminalTestWindow extends Window {
  hermesDesktop: { terminal: {
    start: (options: { persistent: boolean; reference: unknown }) => Promise<{ id: string }>
    read: (id: string, after: number) => Promise<{ events: Array<{ data?: string }> }>
    dispose: (id: string) => Promise<boolean>
  } }
}

test.beforeEach(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterEach(async () => {
  await fixture?.cleanup()
})

test('compact app controls stay in the header and extra actions stay in the menu', async ({}, testInfo) => {
  const { page, app } = fixture
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const toolbar = page.getByLabel('App controls', { exact: true })
  const menu = toolbar.getByRole('button', { name: 'More app actions' })
  const createNew = toolbar.getByRole('button', { name: 'New session', exact: true })
  const inlineNames = () => toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))

  await expect(createNew).toBeVisible()
  const baseline = await inlineNames()
  expect(baseline.slice(-3)).toEqual(['New project', 'New terminal', 'New session'])
  const rect = await toolbar.boundingBox()
  expect(rect).not.toBeNull()
  expect(rect!.y).toBeLessThan(20)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(34)

  // Native drag regions must not cover any part of the fixed toolbar.
  await expect.poll(() => page.evaluate(() => {
    const toolbar = document.querySelector('[aria-label="App controls"]')!.getBoundingClientRect()
    return [...document.querySelectorAll('div')].filter(element =>
      getComputedStyle(element).getPropertyValue('-webkit-app-region') === 'drag'
    ).every(element => {
      const box = element.getBoundingClientRect()
      return box.width === 0 || box.height === 0 || box.right <= toolbar.left || box.left >= toolbar.right || box.bottom <= toolbar.top || box.top >= toolbar.bottom
    })
  })).toBe(true)

  await page.screenshot({ path: testInfo.outputPath('header-wide.png'), fullPage: true })
  await toolbar.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await expect(createNew).toBeVisible()
  await menu.click()
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await toolbar.getByRole('button', { name: 'Show sidebar', exact: true }).click()

  for (const width of [720, 1600]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    await expect(createNew).toBeVisible()
    await expect.poll(inlineNames).toEqual(baseline)
    await expect(toolbar.getByRole('button', { name: 'Capabilities', exact: true })).toHaveCount(0)
    await menu.click()
    await expect(page.getByRole('menuitem')).toHaveText(['Approvals', 'Views', 'Settings'])
    await page.getByRole('menuitem', { name: 'Views', exact: true }).hover()
    await expect(page.getByRole('menuitem', { name: 'Capabilities', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Messaging', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`header-menu-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  }

  await menu.click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('tab', { name: /Settings/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('separate header buttons open session, project and terminal actions', async ({}, testInfo) => {
  const { page } = fixture
  const toolbar = page.getByLabel('App controls', { exact: true })
  await expect(toolbar.getByRole('button', { name: 'Create new', exact: true })).toHaveCount(0)
  const composer = page.locator('[contenteditable="true"]:visible').first()
  await composer.fill('Keep this draft before creating a new session')
  for (const name of ['New session', 'New project', 'New terminal']) {
    await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible()
  }

  await page.screenshot({ path: testInfo.outputPath('creation-buttons.png'), fullPage: true })
  await toolbar.getByRole('button', { name: 'New session', exact: true }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(composer).toHaveText('')

  await toolbar.getByRole('button', { name: 'New project', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'New project', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  await toolbar.getByRole('button', { name: 'New terminal', exact: true }).click()
  await expect(page.locator('.xterm:visible').first()).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)
  const tab = page.locator('[data-tree-tab^="terminal-instance:"]').first()
  const id = (await tab.getAttribute('data-tree-tab'))!.slice('terminal-instance:'.length)
  const host = page.locator(`[data-persistent-terminal="${id}"]`)
  // xterm mounts before its async PTY start; don't send input until attached.
  await expect(host.getByRole('status', { name: 'Loading', exact: true })).toHaveCount(0)
  const input = host.locator('.xterm-helper-textarea')
  await input.focus()
  await expect(input).toBeFocused()
  await input.pressSequentially('printf "HEADER_%s\\n" "TERMINAL_OK"')
  await input.press('Enter')
  // The persistent host owns output; reviveBuffer is only the legacy PTY path.
  const observer = await page.evaluate(async id => {
    const saved = JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') || '{}')
    const terminal = saved.terminals.find((terminal: { id: string }) => terminal.id === id)
    return (window as unknown as TerminalTestWindow).hermesDesktop.terminal.start({ persistent: true, reference: terminal.reference })
  }, id)
  try {
    await expect.poll(() => page.evaluate(async observerId => {
      const result = await (window as unknown as TerminalTestWindow).hermesDesktop.terminal.read(observerId, 0)
      return result.events.map(event => event.data ?? '').join('')
    }, observer.id)).toContain('HEADER_TERMINAL_OK')
  } finally {
    await page.evaluate(observerId => (window as unknown as TerminalTestWindow).hermesDesktop.terminal.dispose(observerId), observer.id)
  }
  await page.screenshot({ path: testInfo.outputPath('header-terminal.png'), fullPage: true })
})

test('approval, keep-awake and layout preferences live in the dropdown', async ({}, testInfo) => {
  const { page } = fixture
  const toolbar = page.getByLabel('App controls', { exact: true })
  const menu = toolbar.getByRole('button', { name: 'More app actions' })
  await expect(toolbar.getByRole('button', { name: /Approval|Keep computer awake|Use .*layout/ })).toHaveCount(0)
  await menu.click()
  const preferences = page.getByRole('toolbar', { name: 'More controls' })
  await expect(preferences.getByRole('button', { name: 'Keep computer awake: Off', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Keep computer awake|Use .*layout/ })).toHaveCount(0)
  await preferences.getByRole('button', { name: 'Mute haptics', exact: true }).click()
  await menu.click()
  await expect(preferences.getByRole('button', { name: 'Unmute haptics', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await preferences.getByRole('button', { name: 'Unmute haptics', exact: true }).click()
  await menu.click()
  await expect(preferences.getByRole('button', { name: 'Mute haptics', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => preferences.evaluate(element => {
    const box = element.getBoundingClientRect()
    return [...element.querySelectorAll('button')].every(button => {
      const rect = button.getBoundingClientRect()
      return rect.left >= box.left && rect.right <= box.right && rect.bottom <= box.bottom
    })
  })).toBe(true)
  await page.getByRole('menuitem', { name: /Approval/ }).hover()
  await expect(page.getByRole('menuitemradio', { name: /^Smart/ })).toBeChecked()
  await expect(page.getByRole('menuitemradio', { name: /^Yolo/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('approval-submenu.png'), fullPage: true })
  await page.getByRole('menuitemradio', { name: /^Yolo/ }).click()
  await menu.click()
  await page.getByRole('menuitem', { name: /Approval/ }).hover()
  await expect(page.getByRole('menuitemradio', { name: /^Yolo/ })).toBeChecked()
  await page.getByRole('menuitemradio', { name: /^Manual/ }).click()
  await menu.click()
  await page.getByRole('menuitem', { name: /Approval/ }).hover()
  await expect(page.getByRole('menuitemradio', { name: /^Manual/ })).toBeChecked()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await menu.click()
  await preferences.getByRole('button', { name: 'Keep computer awake: Off', exact: true }).click()
  await menu.click()
  await expect(preferences.getByRole('button', { name: 'Keep computer awake: On', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await preferences.getByRole('button', { name: 'Keep computer awake: On', exact: true }).click()
  await menu.click()
  await preferences.getByRole('button', { name: 'Use scroll-window layout', exact: true }).click()
  await menu.click()
  await expect(preferences.getByRole('button', { name: 'Use tabbed layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: testInfo.outputPath('preferences-menu.png'), fullPage: true })
  await preferences.getByRole('button', { name: 'Use tabbed layout', exact: true }).click()
})
