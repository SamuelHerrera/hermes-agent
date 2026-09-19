import type { HermesApiRequest } from '@/global'

export interface BrowserBootstrapConfig {
  authRequired: boolean
  basePath: string
  sessionToken: string | null
}

interface BrowserApiDependencies {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  defaultTimeoutMs?: number
  assignLocation?: (url: string) => void
}

export class BrowserApiError extends Error {
  readonly code: 'http' | 'network' | 'timeout'
  readonly loginUrl: null | string
  readonly status: number | null

  constructor(
    message: string,
    options: { code: BrowserApiError['code']; status?: number | null; loginUrl?: null | string; cause?: unknown }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BrowserApiError'
    this.code = options.code
    this.loginUrl = options.loginUrl ?? null
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

interface ResponseFailure {
  loginUrl: null | string
  message: string
}

async function responseFailure(response: Response, basePath: string): Promise<ResponseFailure> {
  const text = await response.text()

  if (!text) {return { loginUrl: null, message: `HTTP ${response.status}` }}

  try {
    const value = JSON.parse(text) as { detail?: unknown; error?: unknown; login_url?: unknown; message?: unknown }
    const detail = value.detail ?? value.error ?? value.message
    const expectedLoginPrefix = `${basePath}/login`

    const loginUrl =
      response.status === 401 &&
      typeof value.login_url === 'string' &&
      (value.login_url === expectedLoginPrefix || value.login_url.startsWith(`${expectedLoginPrefix}?`))
        ? value.login_url
        : null

    return { loginUrl, message: typeof detail === 'string' ? detail : text }
  } catch {
    return { loginUrl: null, message: text }
  }
}

export function createBrowserApi(config: BrowserBootstrapConfig, dependencies: BrowserApiDependencies = {}) {
  const fetcher = dependencies.fetch ?? fetch
  const defaultTimeoutMs = dependencies.defaultTimeoutMs ?? 30_000
  const assignLocation = dependencies.assignLocation ?? (url => window.location.assign(url))

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
        const failure = await responseFailure(response, config.basePath)

        if (failure.loginUrl) {assignLocation(failure.loginUrl)}

        throw new BrowserApiError(`${response.status}: ${failure.message}`, {
          code: 'http',
          loginUrl: failure.loginUrl,
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
