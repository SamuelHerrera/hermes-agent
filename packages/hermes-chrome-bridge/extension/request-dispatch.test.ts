import { describe, expect, it, vi } from 'vitest'

import { createBridgeRequestDispatcher } from './request-dispatch.js'
import { TabServiceError } from './tab-service.js'

function setup() {
  const sendTabMessage = vi.fn<(tabId: number, message: unknown) => Promise<unknown>>(async () => ({
    result: { count: 1, elements: [{ ref: 'e1' }], format: 'both', truncated: false, version: 1 },
    type: 'hermes.bridge.result',
    version: 1
  }))

  const tabService = {
    assertControllable: vi.fn(async () => undefined),
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

  const tabActions = {
    close: vi.fn(async ({ tabId }: { tabId: number }) => ({ closed: true as const, tabId })),
    focus: vi.fn(async ({ tabId }: { tabId: number }) => ({ focused: true as const, tabId })),
    navigate: vi.fn(async ({ tabId }: { tabId: number, url: string }) => ({ navigated: true as const, tabId })),
    open: vi.fn(async () => ({ opened: true as const, tabId: 22 }))
  }

  const screenshotService = {
    capture: vi.fn(async ({ format, tabId }: { format: 'jpeg' | 'png', tabId: number }) => ({
      bytes: 6,
      dataUrl: `data:image/${format};base64,aGVybWVz`,
      format,
      tabId
    }))
  }

  const dispatch = createBridgeRequestDispatcher({
    getConnectionState: () => 'connected',
    screenshotService,
    sendTabMessage,
    tabActions,
    tabService
  })

  return { dispatch, screenshotService, sendTabMessage, tabActions, tabService }
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

  it('rejects guessed non-controllable tab IDs before sending page messages', async () => {
    const { dispatch, sendTabMessage, tabService } = setup()
    tabService.assertControllable.mockRejectedValueOnce(
      new TabServiceError('TAB_NOT_CONTROLLABLE', 'The requested tab is not controllable.')
    )

    await expect(dispatch({
      arguments: { selector: 'button', tabId: 99 },
      id: 'guarded',
      method: 'query',
      type: 'request'
    })).resolves.toMatchObject({ error: { code: 'TAB_NOT_CONTROLLABLE' } })
    expect(sendTabMessage).not.toHaveBeenCalled()
  })

  it('routes navigation and tab lifecycle actions through the guarded tab service', async () => {
    const { dispatch, tabActions } = setup()

    const requests = [
      { arguments: { active: false, url: 'https://example.test/' }, id: '1', method: 'open' },
      { arguments: { tabId: 22, url: 'https://example.test/next' }, id: '2', method: 'navigate' },
      { arguments: { tabId: 22 }, id: '3', method: 'focus' },
      { arguments: { tabId: 22 }, id: '4', method: 'close' }
    ]

    for (const request of requests) {
      await expect(dispatch({ ...request, type: 'request' })).resolves.toMatchObject({ type: 'response' })
    }

    expect(tabActions.open).toHaveBeenCalledWith({ active: false, url: 'https://example.test/' })
    expect(tabActions.navigate).toHaveBeenCalledWith({ tabId: 22, url: 'https://example.test/next' })
    expect(tabActions.focus).toHaveBeenCalledWith({ tabId: 22 })
    expect(tabActions.close).toHaveBeenCalledWith({ tabId: 22 })
  })

  it('routes click, type, key, scroll, and hover with strict bounded payloads', async () => {
    const { dispatch, sendTabMessage } = setup()

    const requests = [
      { arguments: { button: 'right', tabId: 9, target: 'e1' }, id: '1', method: 'click' },
      { arguments: { submit: true, tabId: 9, target: 'e2', text: 'explicit text' }, id: '2', method: 'type' },
      { arguments: { key: 'Enter', modifiers: ['ctrl'], tabId: 9 }, id: '3', method: 'key' },
      { arguments: { deltaX: 0, deltaY: 100, tabId: 9, target: 'e3' }, id: '4', method: 'scroll' },
      { arguments: { tabId: 9, target: 'e4' }, id: '5', method: 'hover' }
    ]

    for (const request of requests) {
      await expect(dispatch({ ...request, type: 'request' })).resolves.toMatchObject({ type: 'response' })
    }

    expect(sendTabMessage.mock.calls.map(call => call[1])).toEqual([
      { button: 'right', target: 'e1', type: 'hermes.bridge.click', version: 1 },
      { submit: true, target: 'e2', text: 'explicit text', type: 'hermes.bridge.type', version: 1 },
      { key: 'Enter', modifiers: ['ctrl'], type: 'hermes.bridge.key', version: 1 },
      { deltaX: 0, deltaY: 100, target: 'e3', type: 'hermes.bridge.scroll', version: 1 },
      { target: 'e4', type: 'hermes.bridge.hover', version: 1 }
    ])
  })

  it('rejects malformed mutation arguments before browser or page actions', async () => {
    const { dispatch, sendTabMessage, tabActions } = setup()

    const requests = [
      { arguments: { active: 'yes' }, id: '1', method: 'open' },
      { arguments: { tabId: 0, url: 'https://example.test/' }, id: '2', method: 'navigate' },
      { arguments: { button: 'invalid', tabId: 1, target: 'e1' }, id: '3', method: 'click' },
      { arguments: { submit: false, tabId: 1, target: 'e1', text: 'x', extra: true }, id: '4', method: 'type' },
      { arguments: { key: '', modifiers: [], tabId: 1 }, id: '5', method: 'key' },
      { arguments: { deltaX: 0, deltaY: 100_001, tabId: 1 }, id: '6', method: 'scroll' },
      { arguments: { tabId: 1, target: '' }, id: '7', method: 'hover' }
    ]

    for (const request of requests) {
      await expect(dispatch({ ...request, type: 'request' })).resolves.toMatchObject({
        error: { code: 'INVALID_ARGUMENTS' }
      })
    }

    expect(sendTabMessage).not.toHaveBeenCalled()
    expect(tabActions.open).not.toHaveBeenCalled()
    expect(tabActions.navigate).not.toHaveBeenCalled()
  })

  it('routes guarded eval, console, and screenshot requests with bounded payloads', async () => {
    const { dispatch, screenshotService, sendTabMessage } = setup()

    await expect(dispatch({
      arguments: { source: 'document.title', tabId: 9, timeoutMs: 500 },
      id: 'eval',
      method: 'eval',
      type: 'request'
    })).resolves.toMatchObject({ id: 'eval', type: 'response' })
    await expect(dispatch({
      arguments: { levels: ['error'], limit: 10, tabId: 9 },
      id: 'console',
      method: 'console',
      type: 'request'
    })).resolves.toMatchObject({ id: 'console', type: 'response' })
    await expect(dispatch({
      arguments: { format: 'jpeg', quality: 80, tabId: 9 },
      id: 'screenshot',
      method: 'screenshot',
      type: 'request'
    })).resolves.toMatchObject({ result: { bytes: 6, format: 'jpeg' } })

    expect(sendTabMessage).toHaveBeenCalledWith(9, {
      source: 'document.title',
      timeoutMs: 500,
      type: 'hermes.bridge.eval',
      version: 1
    })
    expect(sendTabMessage).toHaveBeenCalledWith(9, {
      levels: ['error'],
      limit: 10,
      timeoutMs: 2_000,
      type: 'hermes.bridge.console',
      version: 1
    })
    expect(screenshotService.capture).toHaveBeenCalledWith({ format: 'jpeg', quality: 80, tabId: 9 })
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
