import type { McpTestResult } from '@/hermes'

export interface ChromeBridgeHealthPayload {
  bridgeConnected?: boolean
  connected?: boolean
  nativeConnected?: boolean
  selectedTabId?: number
}

export type ChromeBridgeHealthState = 'connected' | 'disconnected'

export function chromeBridgeHealthState(probe: McpTestResult | 'probing' | undefined): ChromeBridgeHealthState | null {
  if (!probe || probe === 'probing' || !probe.ok) {
    return null
  }

  const health = probe.health?.chromeBridge

  if (!health) {
    return null
  }

  const connected = health.connected === true ||
    (health.bridgeConnected === true && health.nativeConnected === true)

  return connected ? 'connected' : 'disconnected'
}
