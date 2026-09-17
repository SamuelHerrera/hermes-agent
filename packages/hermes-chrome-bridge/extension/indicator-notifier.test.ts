import { describe, expect, it, vi } from 'vitest'

import { hideControlIndicators, notifyControlActivity } from './indicator-notifier.js'

describe('indicator disconnect notifier', () => {
  it('sends only cursor coordinates to the top frame, never broadcasting target metadata', async () => {
    const sendMessage = vi.fn(async () => undefined)
    const target = { x: 43, y: 57, sensitive: false, boundingBox: { x: 0 }, ref: 'private-ref' }
    await notifyControlActivity({ sendMessage }, 1, target)
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(1, { type: 'hermes.bridge.indicator', active: true, version: 2, x: 43, y: 57 }, { frameId: 0 })
  })
  it('hides all reachable indicators and ignores unavailable tabs', async () => {
    const sendMessage = vi.fn(async (tabId: number) => {
      if (tabId === 2) { throw new Error('content script unavailable') }

      return { tabId }
    })

    await expect(hideControlIndicators({
      query: vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: undefined }, { id: 0 }]),
      sendMessage
    })).resolves.toBeUndefined()

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenCalledWith(1, {
      active: false,
      type: 'hermes.bridge.indicator',
      version: 2
    })
  })
})
