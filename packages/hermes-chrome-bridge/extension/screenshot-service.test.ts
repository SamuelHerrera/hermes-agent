import { describe, expect, it, vi } from 'vitest'

import { createScreenshotService, ScreenshotError } from './screenshot-service.js'

function setup(dataUrl = 'data:image/png;base64,aGVybWVz') {
  const tabs = {
    get: vi.fn(async () => ({ id: 7, windowId: 3 })),
    query: vi.fn(async () => [{ id: 2, windowId: 3 }]),
    update: vi.fn(async () => undefined)
  }

  const captureVisibleTab = vi.fn(async () => dataUrl)

  return {
    captureVisibleTab,
    service: createScreenshotService({ captureVisibleTab, tabs }),
    tabs
  }
}

describe('bounded screenshot capture', () => {
  it('temporarily activates a target, captures, and restores the prior active tab', async () => {
    const { captureVisibleTab, service, tabs } = setup()

    await expect(service.capture({ format: 'png', tabId: 7 })).resolves.toMatchObject({
      bytes: 6,
      dataUrl: 'data:image/png;base64,aGVybWVz',
      format: 'png'
    })
    expect(tabs.update.mock.calls).toEqual([[7, { active: true }], [2, { active: true }]])
    expect(captureVisibleTab).toHaveBeenCalledWith(3, { format: 'png' })
  })

  it('bounds and validates image responses without leaking browser errors', async () => {
    const invalid = setup('data:text/plain;base64,c2VjcmV0')
    await expect(invalid.service.capture({ format: 'png', tabId: 7 })).rejects.toMatchObject({
      code: 'INVALID_SCREENSHOT'
    })

    const failed = setup()
    failed.captureVisibleTab.mockRejectedValueOnce(new Error('private browser detail'))

    try {
      await failed.service.capture({ format: 'jpeg', quality: 80, tabId: 7 })
      throw new Error('expected capture failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ScreenshotError)
      expect((error as Error).message).not.toContain('private browser detail')
    }
  })
})
