import { expect, test } from '@playwright/test'

import { type BrowserBackend, startBrowserBackend } from './browser-backend'

let backend: BrowserBackend
test.use({ channel: 'chrome', hasTouch: true, viewport: { width: 574, height: 844 } })
test.beforeAll(async () => {
  backend = await startBrowserBackend()
})
test.afterAll(async () => {
  await backend?.cleanup()
})

test('chats sidebar pushes at available layout width and overlays only constrained widths', async ({
  page
}, testInfo) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('hermes.browser.uiScale.v1') === null) {
      localStorage.setItem('hermes.browser.uiScale.v1', '75')
    }
  })
  await page.goto(`${backend.baseUrl}/desktop/`)
  await page.getByRole('button', { name: "I'll choose a provider later" }).click()
  await expect(page.locator('[data-slot="composer-root"]')).toBeVisible()
  const sidebar = page.locator('[data-slot="sidebar"]:visible').first()
  const chat = page
    .locator('[data-tree-group]')
    .filter({ has: page.locator('[data-slot="composer-root"]') })
    .first()
  const geometry = async () => {
    const s = await sidebar.boundingBox()
    const c = await chat.boundingBox()
    return { sidebar: s, chat: c, gap: c && s ? c.x - s.x - s.width : -999 }
  }
  // Titan2 at 75%: physical width still matches a mobile media query, but the
  // shared document has enough CSS layout width to dock the chats rail.
  if (!(await sidebar.count())) {
    await page.getByRole('button', { name: /^(Show|Hide) sidebar$/, exact: true }).click()
  }
  await expect(sidebar).toBeVisible()
  await expect.poll(async () => (await geometry()).gap).toBeGreaterThanOrEqual(-1)
  // Live toolbar changes must switch both the render path and the toggle path;
  // changing CSS zoom does not emit a matchMedia change event.
  await page.getByRole('button', { name: 'More app actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Increase UI scale', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(sidebar).toHaveCount(0)
  await page.getByRole('button', { name: /^(Show|Hide) sidebar$/, exact: true }).click()
  await expect.poll(async () => (await geometry()).gap).toBeLessThan(-10)
  await page.getByRole('button', { name: 'More app actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Decrease UI scale', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await geometry()).gap).toBeGreaterThanOrEqual(-1)
  for (const scenario of [
    { name: 'narrow-portrait', width: 390, height: 844, scale: 100, docked: false },
    { name: 'wide-landscape', width: 844, height: 390, scale: 100, docked: true },
    { name: 'titan-zoomed-out', width: 574, height: 576, scale: 75, docked: true },
    { name: 'zoomed-in', width: 844, height: 390, scale: 150, docked: false },
    { name: 'boundary-narrow', width: 640, height: 700, scale: 100, docked: false },
    { name: 'boundary-docked', width: 641, height: 700, scale: 100, docked: true }
  ]) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height })
    // Drive the same scale authority used by the toolbar, not just a CSS edit.
    await page.getByRole('button', { name: 'More app actions', exact: true }).click()
    // Reload with the origin-local preference, exercising initialization too.
    await page.evaluate(scale => localStorage.setItem('hermes.browser.uiScale.v1', String(scale)), scenario.scale)
    await page.reload()
    await expect(page.locator('[data-slot="composer-root"]')).toBeVisible()
    if (!scenario.docked) {
      await page.getByRole('button', { name: /^(Show|Hide) sidebar$/, exact: true }).click()
    }
    await expect(sidebar).toBeVisible()
    if (scenario.docked) {
      await expect.poll(async () => (await geometry()).gap).toBeGreaterThanOrEqual(-1)
    } else {
      await expect.poll(async () => (await geometry()).gap).toBeLessThan(-10)
    }
    const samples = []
    for (let frame = 0; frame < 15; frame++) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      samples.push(await geometry())
    }
    expect(
      Math.max(...samples.map(sample => sample.gap)) - Math.min(...samples.map(sample => sample.gap))
    ).toBeLessThan(1)
    console.log(JSON.stringify({ scenario, geometry: samples[0] }))
    await page.screenshot({ path: testInfo.outputPath(`${scenario.name}.png`) })
  }
})
