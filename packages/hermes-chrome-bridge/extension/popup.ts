import type { ConnectionState } from './lifecycle.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isConnectionState(value: unknown): value is ConnectionState {
  if (!isRecord(value) || !isRecord(value.retry)) { return false }

  return (value.connection === 'disconnected' || value.connection === 'connecting' ||
      value.connection === 'connected' || value.connection === 'error') &&
    typeof value.optedIn === 'boolean' &&
    Number.isInteger(value.retry.attempt) &&
    typeof value.retry.scheduled === 'boolean' &&
    (value.retry.nextDelayMs === undefined || typeof value.retry.nextDelayMs === 'number') &&
    (value.lastError === undefined || (
      isRecord(value.lastError) &&
      typeof value.lastError.code === 'string' &&
      typeof value.lastError.message === 'string'
    ))
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (element === null) { throw new Error('popup shell is incomplete') }

  return element
}

const status = requireElement<HTMLElement>('#status')
const detail = requireElement<HTMLElement>('#detail')
const connectButton = requireElement<HTMLButtonElement>('#connect')
const disconnectButton = requireElement<HTMLButtonElement>('#disconnect')

function render(state: ConnectionState): void {
  status.textContent = state.connection
  status.dataset.state = state.connection
  detail.textContent = state.lastError?.message ?? (
    state.connection === 'connected'
      ? 'Hermes is connected through the native host.'
      : state.connection === 'connecting'
        ? 'Connecting to the Hermes native host…'
        : 'Connect only when you want Hermes to use this bridge.'
  )
  connectButton.hidden = state.optedIn
  disconnectButton.hidden = !state.optedIn
  connectButton.disabled = state.connection === 'connecting'
}

function renderUnavailable(): void {
  status.textContent = 'error'
  status.dataset.state = 'error'
  detail.textContent = 'The extension service worker is unavailable.'
  connectButton.disabled = false
  disconnectButton.disabled = false
}

async function sendCommand(type: 'bridge.connect' | 'bridge.disconnect' | 'bridge.status'): Promise<void> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type })

    if (!isRecord(response) || !isConnectionState(response.state)) {
      renderUnavailable()

      return
    }

    render(response.state)
  } catch {
    renderUnavailable()
  }
}

connectButton.addEventListener('click', () => void sendCommand('bridge.connect'))
disconnectButton.addEventListener('click', () => void sendCommand('bridge.disconnect'))
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isRecord(message) && message.type === 'bridge.state' && isConnectionState(message.state)) {
    render(message.state)
  }
})

void sendCommand('bridge.status')
