import { expect, test } from './test'

import { type MockBackendFixture, selectCreateAction, setupMockBackend, waitForAppReady } from './fixtures'

test.describe('scroll-window layout surface', () => {
  let fixture: MockBackendFixture

  test.beforeEach(async () => {
    fixture = await setupMockBackend()
    await waitForAppReady(fixture, 120_000)
  })

  test.afterEach(async () => {
    await fixture.cleanup()
  })

  test('closes the primary card and supports previewed independent splits and unsplitting', async ({}, testInfo) => {
    const { page } = fixture
    await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(2900, 1100))
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    await page.getByPlaceholder(/search/i).fill('scroll window')
    await page.mouse.move(8, 8)
    await page.locator('[data-slot="command-item"]').filter({ hasText: 'Toggle scroll-window layout' }).click()
    await page.keyboard.press('Escape')
    const windows = page.locator('[data-scroll-window]')
    await expect(windows).toHaveCount(1)
    for (let count = 2; count <= 3; count++) {
      await selectCreateAction(page, 'New session')
      await expect(windows).toHaveCount(count)
    }
    const ids = await windows.evaluateAll(elements => elements.map(el => el.getAttribute('data-scroll-window')!))
    const card = (id: string) => page.locator(`[data-scroll-window="${id}"]`)
    const originalHeight = (await card(ids[1]).boundingBox())!.height
    const drag = async (source: string, target: string, edge: 'bottom' | 'right') => {
      const header = (await card(source).locator('[data-scroll-window-header]').boundingBox())!
      const box = (await card(target).boundingBox())!
      await page.mouse.move(header.x + 80, header.y + 15)
      await page.mouse.down()
      await page.mouse.move(header.x + 100, header.y + 20, { steps: 6 })
      const x = edge === 'bottom' ? box.x + box.width / 2 : box.x + box.width - 15
      const y = edge === 'bottom' ? box.y + box.height - 15 : box.y + box.height / 2
      await page.mouse.move(x, y, { steps: 15 })
      await page.mouse.move(x, y, { steps: 2 })
      const preview = card(target).locator(`[data-scroll-drop-preview="${edge}"]`)
      await expect(preview).toBeVisible()
      await expect(preview).toHaveCSS('border-top-style', 'dashed')
      await expect
        .poll(async () => {
          const previewBox = (await preview.boundingBox())!
          return edge === 'bottom' ? previewBox.height / box.height : previewBox.width / box.width
        })
        .toBeLessThan(0.51)
      await page.screenshot({ path: testInfo.outputPath(`drop-preview-${edge}.png`) })
      await page.mouse.up()
      await expect(page.locator('[data-scroll-drop-preview]')).toHaveCount(0)
    }

    await drag(ids[2], ids[0], 'bottom')
    await expect.poll(async () => (await card(ids[0]).boundingBox())!.height).toBeLessThan(originalHeight)
    expect((await card(ids[1]).boundingBox())!.height).toBe(originalHeight)
    expect((await card(ids[2]).boundingBox())!.x).toBe((await card(ids[0]).boundingBox())!.x)
    await page.screenshot({ path: testInfo.outputPath('independent-column-split.png') })
    await drag(ids[2], ids[1], 'right')
    await expect.poll(async () => (await card(ids[0]).boundingBox())!.height).toBe(originalHeight)
    expect(
      new Set(await windows.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top))).size
    ).toBe(1)

    await card('workspace').getByRole('button', { name: 'Close window', exact: true }).click()
    await expect(card('workspace')).toHaveCount(0)
    await expect(windows).toHaveCount(2)
    expect(await windows.evaluateAll(elements => elements.map(el => el.getAttribute('data-scroll-window')))).toEqual(
      ids.slice(1)
    )
    await windows.first().getByRole('button', { name: 'Close window', exact: true }).click()
    await expect(windows).toHaveCount(1)
    await windows.first().getByRole('button', { name: 'Close window', exact: true }).click()
    await expect(windows).toHaveCount(0)
    await expect(page.getByText('No chat windows here yet')).toBeVisible()
    await selectCreateAction(page, 'New session')
    await expect(windows).toHaveCount(1)
  })

  test('toggles into an isolated scroll-window workspace and back through the command palette', async ({}, testInfo) => {
    const { page } = fixture
    await page.setViewportSize({ width: 1900, height: 1000 })
    const composer = page.locator('[data-slot="composer-surface"]:visible').first()
    await expect(composer).toBeVisible()
    const originalComposerWidth = (await composer.boundingBox())!.width
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

    const firstWindow = page.locator('[data-scroll-window]').first()
    const windowBox = (await firstWindow.boundingBox())!
    const composerBox = (await firstWindow.locator('[data-slot="composer-surface"]').boundingBox())!
    const viewportBox = (await page.locator('[data-scroll-window-viewport]').boundingBox())!
    const gutterWidth = await page.evaluate(() => 2 * parseFloat(getComputedStyle(document.documentElement).fontSize))

    expect(composerBox.width).toBeCloseTo(originalComposerWidth, 0)
    expect(windowBox.width).toBeCloseTo(originalComposerWidth + gutterWidth + 2, 0)
    expect(windowBox.width).toBeLessThan(viewportBox.width)
    await page.screenshot({ path: testInfo.outputPath('capped-chat-window.png') })

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B')
    await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B')
    await expect(page.getByRole('button', { name: 'Hide sidebar' })).toBeVisible()

    await selectCreateAction(page, 'New session')
    await expect(page.locator('[data-scroll-window]')).toHaveCount(2)
    const secondWindowBox = (await page.locator('[data-scroll-window]').nth(1).boundingBox())!
    const firstWindowBox = (await firstWindow.boundingBox())!
    expect(secondWindowBox.x - firstWindowBox.x - firstWindowBox.width).toBeCloseTo(12, 0)

    for (let count = 3; count <= 6; count += 1) {
      await selectCreateAction(page, 'New session')
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

    await viewport.evaluate(element => {
      element.scrollLeft = 0
    })
    const target = page.locator('[data-scroll-window]').nth(1)
    const targetBox = (await target.boundingBox())!
    await page
      .locator('[data-scroll-window-header]')
      .first()
      .dragTo(target, {
        sourcePosition: { x: 80, y: 15 },
        targetPosition: { x: targetBox.width - 15, y: targetBox.height / 2 }
      })

    await expect
      .poll(() =>
        page
          .locator('[data-scroll-window]')
          .evaluateAll(elements => elements.map(element => element.getAttribute('data-scroll-window')))
      )
      .toEqual([idsBeforeDrag[1], idsBeforeDrag[0], ...idsBeforeDrag.slice(2)])

    const firstBoxBeforeResize = await page.locator('[data-scroll-window]').first().boundingBox()

    await page.setViewportSize({ height: 700, width: 1000 })
    await expect
      .poll(async () => (await page.locator('[data-scroll-window]').first().boundingBox())!.width)
      .toBeLessThan(firstBoxBeforeResize!.width)
    await expect
      .poll(async () => (await page.locator('[data-scroll-window]').first().boundingBox())!.height)
      .toBeLessThan(firstBoxBeforeResize!.height)

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

  test('grows small windows to the chat cap and maps the live visible area through resize and scroll', async ({}, testInfo) => {
    const { page } = fixture
    // Resize the native window too: emulated viewports leave Electron's
    // window-controls-overlay bounds stale and can overlap the minimap.
    const resize = async (width: number, height: number) => {
      await fixture.app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setSize(size.width, size.height)
        },
        { width, height }
      )
    }
    await resize(800, 600)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    await page.getByPlaceholder(/search/i).fill('scroll window')
    await page.mouse.move(8, 8)
    await page.locator('[data-slot="command-item"]').filter({ hasText: 'Toggle scroll-window layout' }).click()
    await page.keyboard.press('Escape')
    const windows = page.locator('[data-scroll-window]')
    await expect(windows).toHaveCount(1)
    const smallBox = (await windows.first().boundingBox())!
    for (let count = 2; count <= 3; count += 1) {
      await selectCreateAction(page, 'New session')
      await expect(windows).toHaveCount(count)
    }
    const ids = await windows.evaluateAll(elements =>
      elements.map(element => element.getAttribute('data-scroll-window'))
    )
    await resize(1900, 1000)
    await expect.poll(async () => (await windows.first().boundingBox())!.width).toBeGreaterThan(smallBox.width)
    await expect.poll(async () => (await windows.first().boundingBox())!.height).toBeGreaterThan(smallBox.height)

    const assertMinimap = async () => {
      await expect
        .poll(() =>
          page.evaluate(() => {
            const viewport = document.querySelector<HTMLElement>('[data-scroll-window-viewport]')!
            const miniWindow = document.querySelector<HTMLElement>('button[aria-label="Scroll to window 1"]')!
            const map = miniWindow.parentElement!
            const indicator = map.querySelector<HTMLElement>('span[aria-hidden]')!
            const mapBox = map.getBoundingClientRect()
            const indicatorBox = indicator.getBoundingClientRect()
            const firstWindow = document.querySelector<HTMLElement>('[data-scroll-window]')!
            const windowBox = firstWindow.getBoundingClientRect()
            const viewportBox = viewport.getBoundingClientRect()
            const miniBox = miniWindow.getBoundingClientRect()
            const scale = mapBox.width / viewport.scrollWidth
            return Math.max(
              Math.abs(indicatorBox.width - viewport.clientWidth * scale),
              Math.abs(indicatorBox.x - mapBox.x - viewport.scrollLeft * scale),
              Math.abs(miniBox.width - windowBox.width * scale),
              Math.abs(miniBox.x - mapBox.x - (windowBox.x - viewportBox.x + viewport.scrollLeft) * scale),
              Math.abs(indicatorBox.height - (viewport.clientHeight / viewport.scrollHeight) * mapBox.height)
            )
          })
        )
        .toBeLessThan(0.15)
    }
    await assertMinimap()
    const largeBox = (await windows.first().boundingBox())!
    const surface = (await windows.first().locator('[data-slot="composer-surface"]').boundingBox())!
    const gutters = await page.evaluate(() => 2 * parseFloat(getComputedStyle(document.documentElement).fontSize))
    expect(largeBox.width).toBeCloseTo(surface.width + gutters + 2, 0)
    await page.screenshot({ path: testInfo.outputPath('resized-scroll-windows.png') })

    const viewport = page.locator('[data-scroll-window-viewport]')
    await viewport.evaluate(element => {
      element.scrollLeft = element.scrollWidth
    })
    await assertMinimap()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B')
    await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
    await assertMinimap()
    await resize(2400, 1100)
    await assertMinimap()
    expect((await windows.first().boundingBox())!.width).toBe(largeBox.width)
    await page.getByRole('button', { name: 'Scroll to window 1', exact: true }).click()
    await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBe(0)
    await assertMinimap()
    await resize(800, 600)
    await assertMinimap()
    await expect.poll(async () => (await windows.first().boundingBox())!.width).toBeLessThan(largeBox.width)
    expect(
      await windows.evaluateAll(elements => elements.map(element => element.getAttribute('data-scroll-window')))
    ).toEqual(ids)
    expect(
      new Set(await windows.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top))).size
    ).toBe(1)
    expect(await viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
  })
})
