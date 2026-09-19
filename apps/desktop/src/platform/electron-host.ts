import { electronHostCapabilities } from './capabilities'
import type { HermesHost } from './types'
import type { HermesDesktopBridge } from '@/global'

type ElectronHostBridge = Pick<HermesDesktopBridge, 'api' | 'getConnection' | 'getGatewayWsUrl'>

export function createElectronHost(bridge: ElectronHostBridge): HermesHost {
  return {
    kind: 'electron',
    capabilities: electronHostCapabilities,
    getConnection: profile => bridge.getConnection(profile),
    getGatewayWsUrl: profile => bridge.getGatewayWsUrl(profile),
    api: request => bridge.api(request)
  }
}
