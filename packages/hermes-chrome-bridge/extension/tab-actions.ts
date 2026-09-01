import { isPublicHttpUrl } from './url-policy.js'

interface BrowserTabResult {
  id?: number
  windowId?: number
}

interface TabActionsDependencies {
  assertControllable(tabId: number): Promise<void>
  tabs: {
    create(options: { active: boolean, url?: string }): Promise<BrowserTabResult>
    get(tabId: number): Promise<BrowserTabResult>
    remove(tabId: number): Promise<void>
    update(tabId: number, options: { active?: boolean, url?: string }): Promise<BrowserTabResult | undefined>
  }
  windows: {
    update(windowId: number, options: { focused: boolean }): Promise<unknown>
  }
}

export class TabActionError extends Error {
  public constructor(public readonly code: 'TAB_ACTION_FAILED' | 'URL_BLOCKED', message: string) {
    super(message)
    this.name = 'TabActionError'
  }
}

export interface TabActions {
  close(options: { tabId: number }): Promise<{ closed: true, tabId: number }>
  focus(options: { tabId: number }): Promise<{ focused: true, tabId: number }>
  navigate(options: { tabId: number, url: string }): Promise<{ navigated: true, tabId: number }>
  open(options: { active: boolean, url?: string }): Promise<{ opened: true, tabId: number }>
}

function safeNavigationUrl(raw: string): string {
  if (!isPublicHttpUrl(raw)) {
    throw new TabActionError('URL_BLOCKED', 'The requested navigation URL is blocked.')
  }

  return new URL(raw).toString()
}

function positiveTabId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

export function createTabActions(dependencies: TabActionsDependencies): TabActions {
  const openedTabs = new Map<number, number | undefined>()

  const assertAuthorized = async (tabId: number): Promise<void> => {
    if (!openedTabs.has(tabId)) {
      await dependencies.assertControllable(tabId)
    }
  }

  return {
    async close({ tabId }) {
      if (!positiveTabId(tabId)) {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action is invalid.')
      }

      try {
        await assertAuthorized(tabId)
        await dependencies.tabs.remove(tabId)
        openedTabs.delete(tabId)

        return { closed: true, tabId }
      } catch {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action failed.')
      }
    },

    async focus({ tabId }) {
      if (!positiveTabId(tabId)) {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action is invalid.')
      }

      let windowId: number | undefined

      try {
        await assertAuthorized(tabId)
        const openedWindowId = openedTabs.get(tabId)
        const tab = openedTabs.has(tabId) ? undefined : await dependencies.tabs.get(tabId)
        windowId = openedWindowId ?? tab?.windowId

        if (!openedTabs.has(tabId) && !Number.isInteger(windowId)) {
          throw new Error('missing window')
        }
      } catch {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab is unavailable.')
      }

      try {
        await dependencies.tabs.update(tabId, { active: true })
      } catch {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab could not be activated.')
      }

      if (Number.isInteger(windowId)) {
        try {
          await dependencies.windows.update(windowId as number, { focused: true })
        } catch {
          // Activating the tab is sufficient when the OS refuses to raise the window.
        }
      }

      return { focused: true, tabId }
    },

    async navigate({ tabId, url }) {
      if (!positiveTabId(tabId)) {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action is invalid.')
      }

      const target = safeNavigationUrl(url)

      try {
        await assertAuthorized(tabId)
        await dependencies.tabs.update(tabId, { url: target })

        return { navigated: true, tabId }
      } catch {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action failed.')
      }
    },

    async open({ active, url }) {
      const safeUrl = url === undefined ? undefined : safeNavigationUrl(url)

      try {
        const tab = await dependencies.tabs.create({
          active,
          ...(safeUrl === undefined ? {} : { url: safeUrl })
        })

        if (!positiveTabId(tab.id)) {
          throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action failed.')
        }

        openedTabs.set(tab.id, Number.isInteger(tab.windowId) ? tab.windowId : undefined)

        return { opened: true, tabId: tab.id }
      } catch (error) {
        if (error instanceof TabActionError) { throw error }

        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action failed.')
      }
    }
  }
}
