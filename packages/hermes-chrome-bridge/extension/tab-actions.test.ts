import { describe, expect, it, vi } from 'vitest'

import { createTabActions, TabActionError } from './tab-actions.js'

function setup() {
  const assertControllable = vi.fn(async () => undefined)

  const tabs = {
    create: vi.fn(async () => ({ id: 21, windowId: 3 })),
    get: vi.fn(async () => ({ id: 21, windowId: 3 })),
    remove: vi.fn(async () => undefined),
    update: vi.fn(async () => ({ id: 21, windowId: 3 }))
  }

  const windows = {
    update: vi.fn(async () => undefined)
  }

  return { actions: createTabActions({ assertControllable, tabs, windows }), assertControllable, tabs, windows }
}

describe('safe tab navigation actions', () => {
  it('opens and navigates only public HTTP(S) URLs without returning URL data', async () => {
    const { actions, assertControllable, tabs } = setup()

    await expect(actions.open({ active: false, url: 'https://example.test/path' })).resolves.toEqual({
      opened: true,
      tabId: 21
    })
    expect(tabs.create).toHaveBeenCalledWith({ active: false, url: 'https://example.test/path' })

    await expect(actions.navigate({ tabId: 21, url: 'http://example.test/next' })).resolves.toEqual({
      navigated: true,
      tabId: 21
    })
    expect(tabs.update).toHaveBeenCalledWith(21, { url: 'http://example.test/next' })
    expect(assertControllable).toHaveBeenCalledWith(21)
  })

  it.each([
    'chrome://settings',
    'file:///tmp/private',
    'http://localhost:8000/',
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://169.254.1.1/',
    'http://[::1]/',
    'https://chromewebstore.google.com/detail/example',
    'https://user:password@example.test/'
  ])('blocks unsafe navigation target %s without echoing it', async url => {
    const { actions, tabs } = setup()

    try {
      await actions.navigate({ tabId: 21, url })
      throw new Error('expected navigation rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(TabActionError)
      expect((error as TabActionError).code).toBe('URL_BLOCKED')
      expect((error as Error).message).not.toContain(url)
    }

    expect(tabs.update).not.toHaveBeenCalled()
  })

  it('focuses and closes an explicit tab without page metadata in results', async () => {
    const { actions, assertControllable, tabs, windows } = setup()

    await expect(actions.focus({ tabId: 21 })).resolves.toEqual({ focused: true, tabId: 21 })
    expect(windows.update).toHaveBeenCalledWith(3, { focused: true })
    expect(tabs.update).toHaveBeenCalledWith(21, { active: true })

    await expect(actions.close({ tabId: 21 })).resolves.toEqual({ closed: true, tabId: 21 })
    expect(tabs.remove).toHaveBeenCalledWith(21)
    expect(assertControllable).toHaveBeenCalledTimes(2)
  })

  it('maps browser failures to safe deterministic errors', async () => {
    const { actions, tabs } = setup()
    tabs.remove.mockRejectedValueOnce(new Error('secret browser detail'))

    try {
      await actions.close({ tabId: 99 })
      throw new Error('expected close failure')
    } catch (error) {
      expect(error).toMatchObject({ code: 'TAB_ACTION_FAILED' })
      expect((error as Error).message).not.toContain('secret browser detail')
    }
  })
})
