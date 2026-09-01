import {
  type ConnectionState,
  createConnectionController
} from './lifecycle.js'

const OPT_IN_KEY = 'hermesChromeBridgeOptIn'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPopupCommand(value: unknown): value is { type: 'bridge.connect' | 'bridge.disconnect' | 'bridge.status' } {
  return isRecord(value) && Object.keys(value).length === 1 && (
    value.type === 'bridge.connect' ||
    value.type === 'bridge.disconnect' ||
    value.type === 'bridge.status'
  )
}

const controller = createConnectionController({
  connectNative: hostName => chrome.runtime.connectNative(hostName),
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

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isPopupCommand(message)) { return false }

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

void controller.start()
