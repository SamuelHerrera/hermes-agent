import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $threadScrollByKey,
  onScrollToBottomRequest,
  requestScrollToBottom,
  resetThreadScroll,
  setThreadAtBottom,
  threadScrollStateFor
} from './thread-scroll'

describe('thread scroll store', () => {
  beforeEach(() => {
    $threadScrollByKey.set({})
  })

  it('keeps scrolled state scoped to each chat surface', () => {
    setThreadAtBottom(false, 'main')

    expect(threadScrollStateFor($threadScrollByKey.get(), 'main').scrolledUp).toBe(true)
    expect(threadScrollStateFor($threadScrollByKey.get(), 'tile:s2').scrolledUp).toBe(false)

    resetThreadScroll('main')

    expect(threadScrollStateFor($threadScrollByKey.get(), 'main').scrolledUp).toBe(false)
  })

  it('routes scroll-to-bottom requests to the matching surface only', () => {
    const main = vi.fn()
    const tile = vi.fn()
    const stopMain = onScrollToBottomRequest(main, 'main')
    const stopTile = onScrollToBottomRequest(tile, 'tile:s2')

    requestScrollToBottom('tile:s2')

    expect(main).not.toHaveBeenCalled()
    expect(tile).toHaveBeenCalledTimes(1)

    stopMain()
    stopTile()
  })
})
