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
  return {
    async close({ tabId }) {
      if (!positiveTabId(tabId)) {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action is invalid.')
      }

      try {
        await dependencies.assertControllable(tabId)
        await dependencies.tabs.remove(tabId)

        return { closed: true, tabId }
      } catch {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action failed.')
      }
    },

    async focus({ tabId }) {
      if (!positiveTabId(tabId)) {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action is invalid.')
      }

      try {
        await dependencies.assertControllable(tabId)
        const tab = await dependencies.tabs.get(tabId)

        if (!Number.isInteger(tab.windowId)) {
          throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action failed.')
        }

        await dependencies.windows.update(tab.windowId as number, { focused: true })
        await dependencies.tabs.update(tabId, { active: true })

        return { focused: true, tabId }
      } catch {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action failed.')
      }
    },

    async navigate({ tabId, url }) {
      if (!positiveTabId(tabId)) {
        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action is invalid.')
      }

      const target = safeNavigationUrl(url)

      try {
        await dependencies.assertControllable(tabId)
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

        return { opened: true, tabId: tab.id }
      } catch (error) {
        if (error instanceof TabActionError) { throw error }

        throw new TabActionError('TAB_ACTION_FAILED', 'The requested tab action failed.')
      }
    }
  }
}
