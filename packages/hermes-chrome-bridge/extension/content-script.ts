import { createContentBridgeHandler } from './content-bridge.js'
import { createPageInspector } from './page-inspector.js'

function isPing(message: unknown): message is { type: 'hermes.bridge.ping'; version: 1 } {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) { return false }
  const value = message as Record<string, unknown>

  return Object.keys(value).length === 2 &&
    value.type === 'hermes.bridge.ping' &&
    value.version === 1
}

const handleContentRequest = createContentBridgeHandler(createPageInspector(document))

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) { return false }

  if (isPing(message)) {
    sendResponse({ type: 'hermes.bridge.pong', version: 1 })

    return false
  }

  const response = handleContentRequest(message)

  if (response === undefined) { return false }
  sendResponse(response)

  return false
})
