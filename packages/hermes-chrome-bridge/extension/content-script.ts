import { createContentBridgeHandler } from './content-bridge.js'
import { createControlIndicator } from './control-indicator.js'
import { createPageActions } from './page-actions.js'
import { createPageInspector } from './page-inspector.js'

function isPing(message: unknown): message is { type: 'hermes.bridge.ping'; version: 1 } {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) { return false }
  const value = message as Record<string, unknown>

  return Object.keys(value).length === 2 &&
    value.type === 'hermes.bridge.ping' &&
    value.version === 1
}

const inspector = createPageInspector(document)
const indicator = createControlIndicator(document)

const handleContentRequest = createContentBridgeHandler(
  inspector,
  createPageActions(document, inspector, window, indicator),
  indicator
)

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) { return false }

  if (isPing(message)) {
    sendResponse({ type: 'hermes.bridge.pong', version: 1 })

    return false
  }

  const response = handleContentRequest(message)

  if (response === undefined) { return false }

  if (response instanceof Promise) {
    void response
      .then(result => sendResponse(result))
      .catch(() => sendResponse({
        error: { code: 'PAGE_RUNTIME_FAILED', message: 'The page runtime request failed.' },
        type: 'hermes.bridge.error',
        version: 1
      }))

    return true
  }

  sendResponse(response)

  return false
})
