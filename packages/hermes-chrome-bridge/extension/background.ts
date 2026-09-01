import { isTrustedPopupCommand } from './background-policy.js'
import {
  type ConnectionState,
  createConnectionController
} from './lifecycle.js'

const OPT_IN_KEY = 'hermesChromeBridgeOptIn'

const controller = createConnectionController({
  connectNative: hostName => chrome.runtime.connectNative(hostName),
  consumeNativeDisconnectError: () => { void chrome.runtime.lastError },
  readOptIn: async () => {
    const stored = await chrome.storage.local.get(OPT_IN_KEY)

    return stored[OPT_IN_KEY] === true
  },
  writeOptIn: async optedIn => {
    await chrome.storage.local.set({ [OPT_IN_KEY]: optedIn })
  }
})

function safeResponse(state: ConnectionState): { state: ConnectionState } {
  return { state }
}

controller.subscribe(state => {
  void chrome.runtime.sendMessage({ state, type: 'bridge.state' }).catch(() => undefined)
})

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isTrustedPopupCommand(
    message,
    sender,
    chrome.runtime.id,
    chrome.runtime.getURL('popup.html')
  )) { return false }

  if (message.type === 'bridge.status') {
    sendResponse(safeResponse(controller.getState()))

    return false
  }

  const action = message.type === 'bridge.connect'
    ? controller.connect()
    : controller.disconnect()

  void action
    .then(() => sendResponse(safeResponse(controller.getState())))
    .catch(() => sendResponse({
      state: controller.getState()
    }))

  return true
})

void controller.start().catch(() => undefined)
