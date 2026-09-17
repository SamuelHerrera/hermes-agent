interface IndicatorTabsApi {
  query(): Promise<Array<{ id?: number }>>
  sendMessage(tabId: number, message: unknown, options?: { frameId: number }): Promise<unknown>
}

export async function notifyControlActivity(api: Pick<IndicatorTabsApi, 'sendMessage'>, tabId: number, point?: { x: number, y: number }): Promise<void> {
  try {
    await api.sendMessage(tabId, {
      type: 'hermes.bridge.indicator', active: true, version: 2,
      ...(point ? { x: point.x, y: point.y } : {})
    }, { frameId: 0 })
  } catch { /* The indicator is cosmetic; never repeat an input to display it. */ }
}

export async function hideControlIndicators(api: IndicatorTabsApi): Promise<void> {
  let tabs: Array<{ id?: number }>

  try {
    tabs = await api.query()
  } catch {
    return
  }

  await Promise.all(tabs
    .filter((tab): tab is { id: number } => Number.isInteger(tab.id) && (tab.id ?? 0) > 0)
    .map(async tab => {
      try {
        await api.sendMessage(tab.id, {
          active: false,
          type: 'hermes.bridge.indicator',
          version: 2
        })
      } catch {
        // Tabs without an injected content script are expected and remain untouched.
      }
    }))
}
