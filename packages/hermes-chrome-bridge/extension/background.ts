import { isTrustedPopupCommand } from './background-policy.js'
import { downloadToBrowserHost } from './debugger-download.js'
import { createDebuggerService } from './debugger-service.js'
import { prepareChromeTarget, sendFrameMessage, uploadChromeFiles } from './debugger-target.js'
import { createIdentityStore } from './identity-store.js'
import { hideControlIndicators } from './indicator-notifier.js'
import {
  type ConnectionState,
  createConnectionController
} from './lifecycle.js'
import { createPageRuntimeService } from './page-runtime-service.js'
import { createBridgeRequestDispatcher } from './request-dispatch.js'
import { createScreenshotService } from './screenshot-service.js'
import { createTabActions } from './tab-actions.js'
import { createTabService } from './tab-service.js'
import { isControllableHttpUrl, NETWORK_MODE_KEY, setNetworkMode } from './url-policy.js'

const networkReady = chrome.storage.local.get(NETWORK_MODE_KEY).then(stored => setNetworkMode(stored[NETWORK_MODE_KEY] ?? 'development'))
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[NETWORK_MODE_KEY]) { setNetworkMode(changes[NETWORK_MODE_KEY].newValue ?? 'development') }
})

const OPT_IN_KEY = 'hermesChromeBridgeOptIn'

const tabService = createTabService({
  get: async tabId => chrome.tabs.get(tabId),
  onRemoved: {
    addListener: listener => chrome.tabs.onRemoved.addListener(listener)
  },
  query: async () => chrome.tabs.query({})
})

const tabActions = createTabActions({
  assertControllable: async tabId => tabService.assertControllable(tabId),
  tabs: {
    create: async options => chrome.tabs.create(options),
    get: async tabId => chrome.tabs.get(tabId),
    remove: async tabId => chrome.tabs.remove(tabId),
    update: async (tabId, options) => chrome.tabs.update(tabId, options)
  },
  windows: {
    update: async (windowId, options) => chrome.windows.update(windowId, options)
  }
})

const screenshotService = createScreenshotService({
  beforeCapture: async tabId => {
    const refresh = chrome.tabs.sendMessage(tabId, {
      type: 'hermes.bridge.indicator.refresh',
      version: 1
    }).catch(() => undefined)

    await Promise.race([
      refresh,
      new Promise(resolve => setTimeout(resolve, 200))
    ])
    await new Promise(resolve => setTimeout(resolve, 75))
  },
  captureVisibleTab: async (windowId, options) => chrome.tabs.captureVisibleTab(windowId, options),
  tabs: {
    get: async tabId => chrome.tabs.get(tabId),
    query: async options => chrome.tabs.query(options),
    update: async (tabId, options) => chrome.tabs.update(tabId, options)
  }
})

const pageRuntimeService = createPageRuntimeService()

const debuggerService = createDebuggerService({
  assertControllable: async tabId => tabService.assertControllable(tabId),
  attach: async tabId => chrome.debugger.attach({ tabId }, '1.3'),
  detach: async tabId => chrome.debugger.detach({ tabId }),
  send: async (tabId, method, params) => (await chrome.debugger.sendCommand({ tabId }, method, params) ?? {}) as Record<string, unknown>,
  prepare: prepareChromeTarget,
  upload: uploadChromeFiles,
  frames: async tabId => ({ frames: (await chrome.webNavigation.getAllFrames({ tabId }) ?? []).filter(f => isControllableHttpUrl(f.url)).slice(0, 100).map(f => ({ frameId: f.frameId, parentFrameId: f.parentFrameId, origin: new URL(f.url).origin })) }),
  indicate: async (tabId, x, y) => chrome.tabs.sendMessage(tabId, { type: 'hermes.bridge.indicator', active: true, x, y, version: 1 }).catch(() => undefined),
  download: async (args, check) => downloadToBrowserHost({
    download: async options => chrome.downloads.download(options),
    search: async options => chrome.downloads.search(options),
    cancel: async id => chrome.downloads.cancel(id),
    pause: async () => new Promise(resolve => setTimeout(resolve, 100))
  }, args, check)
})

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== undefined) { debuggerService.event(source.tabId, method, (params ?? {}) as Record<string, unknown>) }
})
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== undefined) { debuggerService.detached(source.tabId, reason) }
})
chrome.tabs.onRemoved.addListener(tabId => { void debuggerService.cancel(tabId) })
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url !== undefined) { void debuggerService.cancel(tabId) }
})
chrome.runtime.onSuspend.addListener(() => { void debuggerService.disconnect() })

let controller: ReturnType<typeof createConnectionController>

const dispatchRequest = createBridgeRequestDispatcher({
  debuggerService,
  getConnectionState: () => controller.getState().connection,
  pageRuntimeService,
  screenshotService,
  sendTabMessage: async (tabId, message) => sendFrameMessage(tabId, message),
  tabActions,
  tabService
})

controller = createConnectionController({
  connectNative: hostName => chrome.runtime.connectNative(hostName),
  consumeNativeDisconnectError: () => { void chrome.runtime.lastError },
  readIdentity: createIdentityStore({
    get: async key => chrome.storage.local.get(key),
    set: async values => chrome.storage.local.set(values)
  }),
  readOptIn: async () => {
    const stored = await chrome.storage.local.get(OPT_IN_KEY)

    return stored[OPT_IN_KEY] === true
  },
  requestHandler: async request => { await networkReady;

 return dispatchRequest(request) },
  writeOptIn: async optedIn => {
    await chrome.storage.local.set({ [OPT_IN_KEY]: optedIn })
  }
})

function safeResponse(state: ConnectionState): { state: ConnectionState } {
  return { state }
}

let bridgeWasConnected = false

controller.subscribe(state => {
  void chrome.runtime.sendMessage({ state, type: 'bridge.state' }).catch(() => undefined)

  const connected = state.connection === 'connected'

  if (bridgeWasConnected && !connected) {
    void debuggerService.disconnect()
    void hideControlIndicators({
      query: async () => chrome.tabs.query({}),
      sendMessage: async (tabId, message) => chrome.tabs.sendMessage(tabId, message)
    })
  }

  bridgeWasConnected = connected
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

  if (message.type === 'bridge.connect') { debuggerService.reconnect() }

  const action = message.type === 'bridge.connect'
    ? controller.connect(message.label)
    : controller.disconnect()

  void action
    .then(() => sendResponse(safeResponse(controller.getState())))
    .catch(() => sendResponse({
      state: controller.getState()
    }))

  return true
})

void controller.start().catch(() => undefined)
