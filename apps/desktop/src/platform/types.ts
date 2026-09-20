import type { GatewayWsUrlResult } from '@hermes/shared'

import type { HermesApiRequest, HermesConnection } from '@/global'

export type HostKind = 'browser' | 'electron'

export interface HostCapabilities {
  backendFiles: boolean
  backendGit: boolean
  backendLifecycle: boolean
  browserClipboard: boolean
  browserMicrophone: boolean
  browserNotifications: boolean
  deepLinkProtocol: boolean
  globalHotkeys: boolean
  nativeDialogs: boolean
  nativeWindows: boolean
  persistentTerminal: boolean
  revealHostPath: boolean
  screenWakeLock: boolean
  windowBelow: boolean
}

export interface HermesHost {
  kind: HostKind
  capabilities: HostCapabilities
  getConnection(profile?: null | string): Promise<HermesConnection>
  getGatewayWsUrl(profile?: null | string): Promise<GatewayWsUrlResult>
  api<T>(request: HermesApiRequest): Promise<T>
}
