interface IndicatorTabsApi {
  query(): Promise<Array<{ id?: number }>>
  sendMessage(tabId: number, message: unknown): Promise<unknown>
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
          version: 1
        })
      } catch {
        // Tabs without an injected content script are expected and remain untouched.
      }
    }))
}
