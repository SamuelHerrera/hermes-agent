import { describe, expect, it, vi } from 'vitest'

import { hideControlIndicators } from './indicator-notifier.js'

describe('indicator disconnect notifier', () => {
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
      version: 1
    })
  })
})
