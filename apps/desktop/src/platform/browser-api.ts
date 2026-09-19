import type { HermesApiRequest } from '@/global'

export interface BrowserBootstrapConfig {
  authRequired: boolean
  basePath: string
  sessionToken: string | null
}

interface BrowserApiDependencies {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  defaultTimeoutMs?: number
}

export class BrowserApiError extends Error {
  readonly code: 'http' | 'network' | 'timeout'
  readonly status: number | null

  constructor(message: string, options: { code: BrowserApiError['code']; status?: number | null; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BrowserApiError'
    this.code = options.code
    this.status = options.status ?? null
  }
}

function scopedPath(basePath: string, path: string, profile?: null | string): string {
  if (!path.startsWith('/api/') && path !== '/api') {
    throw new Error('Browser API paths must be relative /api routes.')
  }

  const url = new URL(`${basePath}${path}`, 'http://hermes.invalid')

  if (profile && !url.searchParams.has('profile')) {
    url.searchParams.set('profile', profile)
  }

  return `${url.pathname}${url.search}${url.hash}`
}

async function responseMessage(response: Response): Promise<string> {
  const text = await response.text()

  if (!text) {return `HTTP ${response.status}`}

  try {
    const value = JSON.parse(text) as { detail?: unknown; error?: unknown; message?: unknown }
    const detail = value.detail ?? value.error ?? value.message

    return typeof detail === 'string' ? detail : text
  } catch {
    return text
  }
}

export function createBrowserApi(config: BrowserBootstrapConfig, dependencies: BrowserApiDependencies = {}) {
  const fetcher = dependencies.fetch ?? fetch
  const defaultTimeoutMs = dependencies.defaultTimeoutMs ?? 30_000

  return async function browserApi<T>(request: HermesApiRequest): Promise<T> {
    if (request.upload) {
      throw new Error('Browser host multipart upload transport is not available.')
    }

    const target = scopedPath(config.basePath, request.path, request.profile)

    const controller = new AbortController()
    const timeoutMs = request.timeoutMs ?? defaultTimeoutMs
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs)
    const headers = new Headers()

    if (config.sessionToken) {headers.set('X-Hermes-Session-Token', config.sessionToken)}

    if (request.body !== undefined) {headers.set('Content-Type', 'application/json')}

    try {
      const response = await fetcher(target, {
        method: request.method ?? 'GET',
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        credentials: 'include',
        headers,
        signal: controller.signal
      })

      if (!response.ok) {
        throw new BrowserApiError(`${response.status}: ${await responseMessage(response)}`, {
          code: 'http',
          status: response.status
        })
      }

      if (response.status === 204) {return undefined as T}

      try {
        return (await response.json()) as T
      } catch (error) {
        throw new BrowserApiError('Backend returned a non-JSON success response.', {
          code: 'network',
          status: response.status,
          cause: error
        })
      }
    } catch (error) {
      if (error instanceof BrowserApiError) {throw error}

      if (controller.signal.aborted) {
        throw new BrowserApiError(`Request timed out after ${timeoutMs}ms.`, { code: 'timeout', cause: error })
      }

      throw new BrowserApiError('Could not reach the Hermes backend.', { code: 'network', cause: error })
    } finally {
      clearTimeout(timeout)
    }
  }
}
