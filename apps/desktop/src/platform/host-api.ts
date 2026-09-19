import type { HermesApiRequest } from '@/global'

import { resolveHost, tryResolveHost } from './host'

export function hasHostApi(): boolean {
  return tryResolveHost() !== null
}

export function hostApi<T>(request: HermesApiRequest): Promise<T> {
  return resolveHost().api<T>(request)
}