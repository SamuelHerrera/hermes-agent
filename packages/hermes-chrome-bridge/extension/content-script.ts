function isPing(message: unknown): message is { type: 'hermes.bridge.ping'; version: 1 } {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) { return false }
  const value = message as Record<string, unknown>

  return Object.keys(value).length === 2 &&
    value.type === 'hermes.bridge.ping' &&
    value.version === 1
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isPing(message)) { return false }
  sendResponse({ type: 'hermes.bridge.pong', version: 1 })

  return false
})
