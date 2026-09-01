import type { ConsoleLevel } from './page-runtime-core.js'

export const MAIN_REQUEST_EVENT = '__hermesChromeBridgeMainRequest'
export const MAIN_RESPONSE_EVENT = '__hermesChromeBridgeMainResponse'

export class PageRuntimeClientError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'PageRuntimeClientError'
  }
}

export interface PageRuntimeClient {
  console(options: {
    levels?: ConsoleLevel[]
    limit?: number
    timeoutMs: number
  }): Promise<unknown>
  eval(options: { source: string, timeoutMs: number }): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requestId(window: Window): string {
  if (typeof window.crypto.randomUUID === 'function') { return window.crypto.randomUUID() }

  const values = new Uint32Array(4)
  window.crypto.getRandomValues(values)

  return [...values].map(value => value.toString(16).padStart(8, '0')).join('')
}

export function createPageRuntimeClient(window: Window): PageRuntimeClient {
  let pending = 0

  const request = (payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> => {
    if (pending >= 8) {
      return Promise.reject(new PageRuntimeClientError('TOO_MANY_REQUESTS', 'Too many page runtime requests are pending.'))
    }

    const id = requestId(window)
    pending += 1

    return new Promise((resolve, reject) => {
      let settled = false

      const finish = (callback: () => void) => {
        if (settled) { return }
        settled = true
        pending -= 1
        window.removeEventListener(MAIN_RESPONSE_EVENT, onResponse)
        clearTimeout(timeout)
        callback()
      }

      const onResponse = (event: Event) => {
        const detail = (event as CustomEvent<unknown>).detail

        if (typeof detail !== 'string' || detail.length > 300_000) { return }

        let response: unknown

        try {
          response = JSON.parse(detail)
        } catch {
          return
        }

        if (!isRecord(response) || response.id !== id || typeof response.ok !== 'boolean') { return }

        if (response.ok) {
          finish(() => resolve(response.result))

          return
        }

        const responseError = response.error

        if (!isRecord(responseError) || typeof responseError.code !== 'string' ||
          typeof responseError.message !== 'string') {
          finish(() => reject(new PageRuntimeClientError('INVALID_RUNTIME_RESPONSE', 'The page runtime response is invalid.')))

          return
        }

        const errorCode = responseError.code
        const errorMessage = responseError.message

        finish(() => reject(new PageRuntimeClientError(
          errorCode.slice(0, 80),
          errorMessage.slice(0, 500)
        )))
      }

      const timeout = setTimeout(() => {
        finish(() => reject(new PageRuntimeClientError('RUNTIME_TIMEOUT', 'The page runtime request timed out.')))
      }, Math.max(100, Math.min(10_000, timeoutMs)))

      window.addEventListener(MAIN_RESPONSE_EVENT, onResponse)
      const CustomEventConstructor = (window as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent

      window.dispatchEvent(new CustomEventConstructor(MAIN_REQUEST_EVENT, {
        detail: JSON.stringify({ id, ...payload })
      }))
    })
  }

  return {
    console: options => request({
      kind: 'console',
      ...(options.levels === undefined ? {} : { levels: options.levels }),
      ...(options.limit === undefined ? {} : { limit: options.limit })
    }, options.timeoutMs),
    eval: options => request({ kind: 'eval', source: options.source }, options.timeoutMs)
  }
}
