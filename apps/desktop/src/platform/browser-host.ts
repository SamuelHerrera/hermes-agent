import { buildHermesWebSocketUrl } from '@hermes/shared'

import type { HermesConnection } from '@/global'

import { BrowserApiError, type BrowserBootstrapConfig, createBrowserApi } from './browser-api'
import { type BackendCapabilityManifest, type BrowserCapabilityEnvironment, browserHostCapabilities } from './capabilities'
import type { HermesHost } from './types'

interface BrowserLocation {
  host: string
  origin: string
  protocol: string
}

interface BrowserHostDependencies {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  location?: BrowserLocation
  environment?: BrowserCapabilityEnvironment
}

interface CapabilityResponse {
  version: number
  capabilities?: {
    files?: boolean
    git?: boolean
    lifecycle?: boolean
    persistentTerminal?: boolean
  }
}

function currentLocation(): BrowserLocation {
  return window.location
}

function manifestCapabilities(value: CapabilityResponse): Partial<BackendCapabilityManifest> {
  if (value.version !== 1 || !value.capabilities) {return {}}

  return {
    backendFiles: value.capabilities.files === true,
    backendGit: value.capabilities.git === true,
    backendLifecycle: value.capabilities.lifecycle === true,
    persistentTerminal: value.capabilities.persistentTerminal === true
  }
}

export async function createBrowserHost(
  config: BrowserBootstrapConfig,
  dependencies: BrowserHostDependencies = {}
): Promise<HermesHost> {
  const location = dependencies.location ?? currentLocation()
  const api = createBrowserApi(config, { fetch: dependencies.fetch })
  let manifest: Partial<BackendCapabilityManifest> = {}

  try {
    manifest = manifestCapabilities(await api<CapabilityResponse>({ path: '/api/capabilities' }))
  } catch (error) {
    // Older backends return 404; connectivity/server failures also fail closed
    // rather than inventing backend powers from the browser client.
    if (!(error instanceof BrowserApiError) || error.status !== 404) {manifest = {}}
  }

  const capabilities = browserHostCapabilities(manifest, dependencies.environment)

  const wsUrl = (profile?: null | string, authParam?: readonly [string, string]) =>
    buildHermesWebSocketUrl({
      path: '/api/ws',
      basePath: config.basePath,
      authParam,
      params: profile ? { profile } : undefined,
      protocol: location.protocol,
      host: location.host
    })

  return {
    kind: 'browser',
    capabilities,
    api,
    async getConnection(profile?: null | string): Promise<HermesConnection> {
      return {
        authMode: config.authRequired ? 'oauth' : 'token',
        baseUrl: `${location.origin}${config.basePath}`,
        isFullscreen: false,
        logs: [],
        mode: 'remote',
        nativeOverlayWidth: 0,
        profile: profile ?? undefined,
        token: config.sessionToken ?? '',
        windowButtonPosition: null,
        wsUrl: wsUrl(profile, config.sessionToken ? ['token', config.sessionToken] : undefined)
      }
    },
    async getGatewayWsUrl(profile?: null | string) {
      if (!config.authRequired) {
        return wsUrl(profile, ['token', config.sessionToken ?? ''])
      }

      const result = await api<{ ticket: string }>({ path: '/api/auth/ws-ticket', method: 'POST' })

      if (!result.ticket) {throw new Error('Backend did not return a WebSocket ticket.')}

      return wsUrl(profile, ['ticket', result.ticket])
    }
  }
}
