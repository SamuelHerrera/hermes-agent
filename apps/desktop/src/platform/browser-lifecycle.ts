import type { HermesHost } from './types'

export type LifecycleAction = 'backend-restart' | 'gateway-restart' | 'uninstall' | 'update'

export interface LifecycleActionAdvertisement {
  supported: boolean
  guidance: string
  confirmation?: null | string
}

export interface LifecycleStatus {
  version: 1
  authority: { externally_managed: boolean; kind: string }
  actions: Record<LifecycleAction, LifecycleActionAdvertisement>
}

export interface LifecycleResult {
  ok: boolean
  action?: string
  name?: string
  relaunch: false
}

export function createBrowserLifecycle(
  host: HermesHost,
  options: { attempts?: number; delay?: (milliseconds: number) => Promise<void> } = {}
) {
  const ensureSupported = () => {
    if (host.kind !== 'browser' || !host.capabilities.backendLifecycle || !host.api) {
      throw new Error('Backend lifecycle is unsupported by this browser host.')
    }
    return host.api
  }
  const status = () => ensureSupported()<LifecycleStatus>({ path: '/api/lifecycle' })

  return {
    status,
    run(action: LifecycleAction, confirmation?: string) {
      return ensureSupported()<LifecycleResult>({
        path: '/api/lifecycle/action',
        method: 'POST',
        body: confirmation ? { action, confirmation } : { action }
      })
    },
    async runAndReconnect(action: Exclude<LifecycleAction, 'uninstall'>) {
      let result: LifecycleResult | null = null
      try {
        result = await this.run(action)
      } catch (error) {
        if (action !== 'backend-restart') throw error
      }
      if (action === 'backend-restart') {
        const reconnected = await this.waitUntilAvailable()
        return {
          result,
          reconnected,
          message: 'Backend reconnected. This browser tab was not relaunched.'
        }
      }
      return { result, reconnected: null, message: 'Action started. This browser tab was not relaunched.' }
    },
    async waitUntilAvailable(): Promise<LifecycleStatus> {
      const attempts = options.attempts ?? 30
      const delay = options.delay ?? (milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds)))
      let lastError: unknown
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await status()
        } catch (error) {
          lastError = error
          if (attempt + 1 < attempts) await delay(1_000)
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Backend connection was lost.')
    }
  }
}
