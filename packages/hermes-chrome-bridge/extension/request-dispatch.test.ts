import { describe, expect, it, vi } from 'vitest'

import { createBridgeRequestDispatcher } from './request-dispatch.js'

function setup() {
  const sendTabMessage = vi.fn<(tabId: number, message: unknown) => Promise<unknown>>(async () => ({
    result: { count: 1, elements: [{ ref: 'e1' }], format: 'both', truncated: false, version: 1 },
    type: 'hermes.bridge.result',
    version: 1
  }))

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
    sendTabMessage,
    tabService
  })

  return { dispatch, sendTabMessage, tabService }
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

  it('routes bounded snapshot and query requests to the selected page', async () => {
    const { dispatch, sendTabMessage } = setup()

    await expect(dispatch({
      arguments: { format: 'accessibility' },
      id: 'snapshot-1',
      method: 'snapshot',
      type: 'request'
    })).resolves.toMatchObject({
      id: 'snapshot-1',
      result: { count: 1 },
      type: 'response'
    })
    expect(sendTabMessage).toHaveBeenCalledWith(9, {
      format: 'accessibility',
      type: 'hermes.bridge.snapshot',
      version: 1
    })

    await expect(dispatch({
      arguments: { limit: 5, selector: 'button', tabId: 12 },
      id: 'query-1',
      method: 'query',
      type: 'request'
    })).resolves.toMatchObject({ id: 'query-1', result: { count: 1 }, type: 'response' })
    expect(sendTabMessage).toHaveBeenCalledWith(12, {
      limit: 5,
      selector: 'button',
      type: 'hermes.bridge.query',
      version: 1
    })
  })

  it('rejects invalid page requests and malformed content responses safely', async () => {
    const { dispatch, sendTabMessage } = setup()

    for (const request of [
      { arguments: { format: 'invalid' }, id: '1', method: 'snapshot' },
      { arguments: { selector: '', tabId: 1 }, id: '2', method: 'query' },
      { arguments: { limit: 101, selector: 'button', tabId: 1 }, id: '3', method: 'query' }
    ]) {
      await expect(dispatch({ ...request, type: 'request' })).resolves.toMatchObject({
        error: { code: 'INVALID_ARGUMENTS' }
      })
    }

    sendTabMessage.mockResolvedValueOnce({ secret: 'must not leak', type: 'unexpected' })

    const malformed = await dispatch({
      arguments: {}, id: '4', method: 'snapshot', type: 'request'
    })

    expect(malformed).toMatchObject({ error: { code: 'INVALID_PAGE_RESPONSE' } })
    expect(JSON.stringify(malformed)).not.toContain('must not leak')
  })

  it('rejects extra arguments and unknown methods with bounded safe errors', async () => {
    const { dispatch } = setup()

    await expect(dispatch({ arguments: { secret: 'never echo me' }, id: '5', method: 'tabs', type: 'request' }))
      .resolves.toMatchObject({ error: { code: 'INVALID_ARGUMENTS' } })
    const unknown = await dispatch({ arguments: {}, id: '6', method: 'unknown', type: 'request' })
    expect(unknown).toMatchObject({ error: { code: 'METHOD_NOT_IMPLEMENTED' } })
    expect(JSON.stringify([unknown])).not.toContain('never echo me')
  })
})
