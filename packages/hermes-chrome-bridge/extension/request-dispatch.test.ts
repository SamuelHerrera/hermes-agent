import { describe, expect, it, vi } from 'vitest'

import { createBridgeRequestDispatcher } from './request-dispatch.js'

function setup() {
  const tabService = {
    getSelectedTabId: vi.fn(() => 9 as number | undefined),
    list: vi.fn(async () => ({
      count: 1,
      selectedTabId: 9,
      tabs: [{
        active: true,
        selected: true,
        tabId: 9,
        title: 'Safe',
        titleRedacted: false,
        titleTruncated: false,
        url: 'https://example.test/',
        urlRedacted: false,
        urlTruncated: false,
        windowId: 1
      }],
      truncated: false
    })),
    select: vi.fn(async (tabId: number) => ({ selectedTabId: tabId }))
  }

  const dispatch = createBridgeRequestDispatcher({
    getConnectionState: () => 'connected',
    tabService
  })

  return { dispatch, tabService }
}

describe('background bridge request dispatch', () => {
  it('returns bounded safe tab discovery through the tabs method', async () => {
    const { dispatch, tabService } = setup()

    await expect(dispatch({ arguments: {}, id: '1', method: 'tabs', type: 'request' })).resolves.toEqual({
      id: '1',
      result: {
        bridgeConnected: true,
        count: 1,
        nativeConnected: true,
        selectedTabId: 9,
        tabs: [expect.objectContaining({ tabId: 9 })],
        truncated: false
      },
      type: 'response'
    })
    expect(tabService.list).toHaveBeenCalledOnce()
  })

  it('selects exactly one positive integer target without focusing it', async () => {
    const { dispatch, tabService } = setup()

    await expect(dispatch({
      arguments: { tabId: 12 }, id: '2', method: 'selectTab', type: 'request'
    })).resolves.toEqual({
      id: '2',
      result: { selectedTabId: 12 },
      type: 'response'
    })
    expect(tabService.select).toHaveBeenCalledWith(12)
  })

  it.each([
    {},
    { tabId: 0 },
    { tabId: -1 },
    { tabId: 1.5 },
    { tabId: '1' },
    { extra: true, tabId: 1 }
  ])('rejects invalid select arguments safely: %j', async arguments_ => {
    const { dispatch, tabService } = setup()

    const response = await dispatch({ arguments: arguments_, id: '3', method: 'selectTab', type: 'request' })

    expect(response).toEqual({
      error: { code: 'INVALID_ARGUMENTS', message: 'selectTab requires exactly one positive integer tabId.' },
      id: '3',
      type: 'response'
    })
    expect(tabService.select).not.toHaveBeenCalled()
  })

  it('reports bridge/native connectivity and selected target without page data', async () => {
    const { dispatch } = setup()

    const response = await dispatch({ arguments: {}, id: '4', method: 'status', type: 'request' })
    const serialized = JSON.stringify(response)

    expect(response).toEqual({
      id: '4',
      result: { bridgeConnected: true, nativeConnected: true, selectedTabId: 9 },
      type: 'response'
    })
    expect(serialized).not.toContain('url')
    expect(serialized).not.toContain('title')
  })

  it('rejects extra arguments and unknown methods with bounded safe errors', async () => {
    const { dispatch } = setup()

    await expect(dispatch({ arguments: { secret: 'never echo me' }, id: '5', method: 'tabs', type: 'request' }))
      .resolves.toMatchObject({ error: { code: 'INVALID_ARGUMENTS' } })
    const unknown = await dispatch({ arguments: {}, id: '6', method: 'snapshot', type: 'request' })
    expect(unknown).toMatchObject({ error: { code: 'METHOD_NOT_IMPLEMENTED' } })
    expect(JSON.stringify([unknown])).not.toContain('never echo me')
  })
})
