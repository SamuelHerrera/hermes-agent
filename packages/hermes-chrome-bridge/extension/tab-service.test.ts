import { describe, expect, it, vi } from 'vitest'

import { createTabService, redactTab } from './tab-service.js'

interface FakeTab {
  active?: boolean
  id?: number
  title?: string
  url?: string
  windowId?: number
}

class RemovedEvent {
  private readonly listeners: Array<(tabId: number) => void> = []

  addListener(listener: (tabId: number) => void): void {
    this.listeners.push(listener)
  }

  emit(tabId: number): void {
    for (const listener of this.listeners) { listener(tabId) }
  }
}

function setup(tabs: FakeTab[], maxTabs = 100) {
  const removed = new RemovedEvent()

  const api = {
    get: vi.fn(async (tabId: number) => {
      const tab = tabs.find(candidate => candidate.id === tabId)

      if (tab === undefined) { throw new Error('No tab') }

      return tab
    }),
    onRemoved: removed,
    query: vi.fn(async () => tabs)
  }

  return { api, removed, service: createTabService(api, { maxTabs }) }
}

describe('safe tab service', () => {
  it('lists controllable tabs deterministically and redacts secrets from URL and title', async () => {
    const querySecret = 'query-secret-should-never-leak'
    const pathToken = 'ghp_abcdefghijklmnopqrstuvwxyz123456'
    const titleToken = 'sk-live-abcdefghijklmnopqrstuvwxyz'

    const { service } = setup([
      {
        active: true,
        id: 22,
        title: `Billing alice@example.com card 4111 1111 1111 1111 ${titleToken}`,
        url: `https://alice:password@example.com/account/${pathToken}/orders?token=${querySecret}#private`,
        windowId: 2
      },
      { active: false, id: 11, title: 'Docs', url: 'http://docs.example.test/guide/start', windowId: 1 }
    ])

    const result = await service.list()
    const serialized = JSON.stringify(result)

    expect(result.count).toBe(2)
    expect(result.selectedTabId).toBe(22)
    expect(result.tabs.map(tab => tab.tabId)).toEqual([11, 22])
    expect(result.tabs[1]).toMatchObject({
      active: true,
      selected: true,
      tabId: 22,
      titleRedacted: true,
      url: 'https://example.com/account/[redacted]/orders',
      urlRedacted: true,
      windowId: 2
    })

    for (const secret of [querySecret, pathToken, titleToken, 'alice@example.com', '4111 1111 1111 1111', 'password']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('selects a controllable tab without activating it and clears selection on removal', async () => {
    const tabs: FakeTab[] = [
      { active: true, id: 1, title: 'One', url: 'https://one.test/', windowId: 1 },
      { active: false, id: 2, title: 'Two', url: 'https://two.test/', windowId: 1 }
    ]

    const { api, removed, service } = setup(tabs)

    await expect(service.select(2)).resolves.toEqual({ selectedTabId: 2 })
    expect(api.get).toHaveBeenCalledWith(2)
    expect(service.getSelectedTabId()).toBe(2)

    removed.emit(2)
    expect(service.getSelectedTabId()).toBeUndefined()
    await expect(service.list()).resolves.toMatchObject({ selectedTabId: 1 })
  })

  it('rejects unsupported, malformed, missing, and non-positive tab targets', async () => {
    const { service } = setup([
      { active: true, id: 1, title: 'Good', url: 'https://good.test/', windowId: 1 },
      { id: 2, title: 'Chrome', url: 'chrome://settings', windowId: 1 },
      { id: 3, title: 'Extension', url: 'chrome-extension://abc/page.html', windowId: 1 },
      { id: 4, title: 'Devtools', url: 'devtools://devtools/', windowId: 1 },
      { id: 5, title: 'Source', url: 'view-source:https://good.test/', windowId: 1 },
      { id: 6, title: 'Data', url: 'data:text/plain,hello', windowId: 1 },
      { id: 7, title: 'About', url: 'about:blank', windowId: 1 },
      { id: 8, title: 'Bad', url: 'not a url', windowId: 1 },
      { id: 9, title: 'Missing', windowId: 1 },
      { id: 0, title: 'Zero', url: 'https://zero.test/', windowId: 1 },
      { id: 10, title: 'Local', url: 'http://localhost:3000/', windowId: 1 },
      { id: 11, title: 'Private', url: 'http://192.168.1.5/', windowId: 1 },
      { id: 12, title: 'Web Store', url: 'https://chromewebstore.google.com/detail/example', windowId: 1 }
    ])

    await expect(service.list()).resolves.toMatchObject({ count: 1 })
    await expect(service.select(2)).rejects.toMatchObject({ code: 'TAB_NOT_CONTROLLABLE' })
    await expect(service.assertControllable(10)).rejects.toMatchObject({ code: 'TAB_NOT_CONTROLLABLE' })
    await expect(service.select(99)).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' })
  })

  it('caps output, reports truncation, and bounds redacted fields', async () => {
    const tabs: FakeTab[] = Array.from({ length: 5 }, (_, index) => ({
      active: index === 4,
      id: index + 1,
      title: `Title ${'x'.repeat(300)}`,
      url: `https://example.test/${'safe/'.repeat(150)}page-${index}`,
      windowId: 1
    }))

    const { service } = setup(tabs, 3)

    const result = await service.list()

    expect(result.tabs).toHaveLength(3)
    expect(result.truncated).toBe(true)
    expect(result.tabs.every(tab => tab.url.length <= 512 && tab.title.length <= 160)).toBe(true)
    expect(result.tabs.every(tab => tab.urlTruncated && tab.titleTruncated)).toBe(true)
  })

  it('redacts control characters and token-like title assignments', () => {
    const tab = redactTab({
      active: false,
      id: 7,
      title: 'API token=abcDEF1234567890abcDEF\u0000 done',
      url: 'https://example.test/normal',
      windowId: 3
    }, false)

    expect(JSON.stringify(tab)).not.toContain('abcDEF1234567890abcDEF')
    expect(tab?.title).not.toContain('\u0000')
    expect(tab?.titleRedacted).toBe(true)
  })
})
