import { expect, test } from './test'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'

test.describe('scroll-window layout surface', () => {
  let fixture: MockBackendFixture

  test.beforeEach(async () => {
    fixture = await setupMockBackend()
    await waitForAppReady(fixture, 120_000)
  })

  test.afterEach(async () => {
    await fixture.cleanup()
  })

  test('toggles into an isolated scroll-window workspace and back through the command palette', async () => {
    const { page } = fixture
    const passiveWheelErrors: string[] = []

    page.on('console', message => {
      const text = message.text()

      if (text.includes('Unable to preventDefault inside passive event listener')) {
        passiveWheelErrors.push(text)
      }
    })

    await expect(page.locator('[data-scroll-window-viewport]')).toHaveCount(0)

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    await page.getByPlaceholder(/search/i).fill('scroll window')
    await page.mouse.move(8, 8)
    await expect(page.getByText('Toggle scroll-window layout')).toBeVisible()
    await page.locator('[data-slot="command-item"]').filter({ hasText: 'Toggle scroll-window layout' }).click()
    await page.keyboard.press('Escape')

    await expect(page.locator('[data-scroll-window-viewport]')).toBeVisible()
    await expect(page.locator('button[aria-label="Switch to workspace 1"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('region', { name: 'Window 1' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hide sidebar' })).toBeVisible()

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B')
    await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B')
    await expect(page.getByRole('button', { name: 'Hide sidebar' })).toBeVisible()

    await page.getByRole('button', { exact: true, name: 'New session' }).click()
    await expect(page.locator('[data-scroll-window]')).toHaveCount(2)

    for (let count = 3; count <= 6; count += 1) {
      await page.getByRole('button', { exact: true, name: 'New session' }).click()
      await expect(page.locator('[data-scroll-window]')).toHaveCount(count)
    }

    const windowTops = await page
      .locator('[data-scroll-window]')
      .evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().top)))

    expect(new Set(windowTops).size).toBe(1)

    const viewport = page.locator('[data-scroll-window-viewport]')
    const overflowMetrics = await viewport.evaluate(element => ({
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth
    }))

    expect(overflowMetrics.scrollWidth).toBeGreaterThan(overflowMetrics.clientWidth)
    expect(overflowMetrics.scrollHeight).toBeLessThanOrEqual(overflowMetrics.clientHeight + 1)

    await viewport.evaluate(element => {
      element.scrollLeft = 0
    })
    await page
      .locator('[data-scroll-window]')
      .first()
      .hover({ position: { x: 120, y: 80 } })
    await page.mouse.wheel(240, 0)
    await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    expect(passiveWheelErrors).toEqual([])

    const sidebar = page.locator('[data-scroll-window-sidebar]')
    const firstBoxBeforeSidebarResize = await page.locator('[data-scroll-window]').first().boundingBox()
    const sidebarBeforeResize = await sidebar.boundingBox()
    const resizerBox = await page.locator('[data-scroll-window-sidebar-resizer]').boundingBox()

    expect(sidebarBeforeResize).not.toBeNull()
    expect(resizerBox).not.toBeNull()

    if (sidebarBeforeResize && resizerBox) {
      await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(resizerBox.x + resizerBox.width / 2 + 60, resizerBox.y + resizerBox.height / 2)
      await page.mouse.up()

      const sidebarAfterResize = await sidebar.boundingBox()
      const firstBoxAfterSidebarResize = await page.locator('[data-scroll-window]').first().boundingBox()

      expect(Math.round(sidebarAfterResize?.width ?? 0)).toBeGreaterThan(Math.round(sidebarBeforeResize.width))
      expect(Math.round(firstBoxAfterSidebarResize?.width ?? 0)).toBe(
        Math.round(firstBoxBeforeSidebarResize?.width ?? 0)
      )
    }

    const idsBeforeDrag = await page
      .locator('[data-scroll-window]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-scroll-window')))

    await page
      .locator('[data-scroll-window]')
      .nth(1)
      .evaluate((target, sourceId) => {
        const dataTransfer = new DataTransfer()
        dataTransfer.setData('application/x-hermes-scroll-window', sourceId ?? '')
        dataTransfer.setData('text/plain', sourceId ?? '')
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
      }, idsBeforeDrag[0])

    await expect
      .poll(() =>
        page
          .locator('[data-scroll-window]')
          .evaluateAll(elements => elements.map(element => element.getAttribute('data-scroll-window')))
      )
      .toEqual([idsBeforeDrag[1], idsBeforeDrag[0], ...idsBeforeDrag.slice(2)])

    const firstBoxBeforeResize = await page.locator('[data-scroll-window]').first().boundingBox()

    await page.setViewportSize({ height: 700, width: 1000 })
    await page.waitForTimeout(150)

    const firstBoxAfterResize = await page.locator('[data-scroll-window]').first().boundingBox()

    expect(Math.round(firstBoxAfterResize?.width ?? 0)).toBe(Math.round(firstBoxBeforeResize?.width ?? 0))
    expect(Math.round(firstBoxAfterResize?.height ?? 0)).toBe(Math.round(firstBoxBeforeResize?.height ?? 0))

    await page.locator('button[aria-label="Switch to workspace 2"]').click()
    await expect(page.locator('button[aria-label="Switch to workspace 2"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('No chat windows here yet')).toBeVisible()

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    await page.getByPlaceholder(/search/i).fill('scroll window')
    await page.mouse.move(8, 8)
    await expect(page.getByText('Toggle scroll-window layout')).toBeVisible()
    await page.locator('[data-slot="command-item"]').filter({ hasText: 'Toggle scroll-window layout' }).click()

    await expect(page.locator('[data-scroll-window-viewport]')).toHaveCount(0)
  })
})
