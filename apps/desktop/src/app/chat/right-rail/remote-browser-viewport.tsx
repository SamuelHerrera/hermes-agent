import { useStore } from '@nanostores/react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { getApiRequestProfile } from '@/hermes'
import { hostApi } from '@/platform/host-api'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'

export interface RemoteBrowserHandle {
  send(command: Record<string, unknown>): void
}
interface ProxyGrant {
  origin: string
  path?: string
  sameOrigin?: boolean
  ticket: string
  expiresIn: number
}
interface BrowserState {
  url?: string
  title?: string
  loading?: boolean
}

function safeUrl(value: unknown): value is string {
  if (value === 'about:blank') {
    return true
  }

  if (typeof value !== 'string' || value.length > 8192) {
    return false
  }

  try {
    const url = new URL(value)

    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

export const RemoteBrowserViewport = forwardRef<
  RemoteBrowserHandle,
  {
    initialUrl: string
    onState(value: BrowserState): void
  }
>(function RemoteBrowserViewport({ initialUrl, onState }, ref) {
  const connection = useStore($connection)
  const profile = useStore($activeGatewayProfile)
  const iframe = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const initial = useRef(initialUrl)
  const originRef = useRef('')
  const callback = useRef(onState)
  callback.current = onState
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [sharedOrigin, setSharedOrigin] = useState(false)

  const send = (command: Record<string, unknown>) => {
    if (command.type === 'navigate') {
      if (!safeUrl(command.url)) {
        return
      }

      if (command.url !== 'about:blank') {
        const hostname = new URL(command.url).hostname
        const proxyHostname = originRef.current ? new URL(originRef.current).hostname : ''

        if (hostname === window.location.hostname || hostname === proxyHostname) {
          setError('Hermes and proxy management pages cannot be opened in the isolated browser.')
          callback.current({ loading: false })

          return
        }
      }

      initial.current = command.url
    } else if (!['back', 'forward', 'reload', 'stop'].includes(String(command.type))) {
      return
    }

    if (ready.current && originRef.current) {
      iframe.current?.contentWindow?.postMessage({ protocol: 'hermes-proxy-v1', command }, originRef.current)
    }
  }

  useImperativeHandle(ref, () => ({ send }))

  // This effect owns one isolated-origin capability and iframe generation.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    let disposed = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    ready.current = false
    originRef.current = ''
    setSrc('')
    setError('')
    setSharedOrigin(false)
    callback.current({ loading: true })

    const fail = (message: string) => {
      if (disposed) {
        return
      }

      ready.current = false
      clearTimeout(timeout)
      setError(message)
      callback.current({ loading: false })
    }

    const receive = (event: MessageEvent) => {
      if (
        disposed ||
        !originRef.current ||
        event.source !== iframe.current?.contentWindow ||
        event.origin !== originRef.current ||
        event.data?.protocol !== 'hermes-proxy-v1'
      ) {
        return
      }

      const data = event.data

      if (data.type === 'ready') {
        clearTimeout(timeout)
        ready.current = true
        send({ type: 'navigate', url: initial.current })
      } else if (data.type === 'state') {
        const state: BrowserState = { loading: data.loading === true }

        if (safeUrl(data.url)) {
          state.url = data.url
          initial.current = data.url
        }

        if (typeof data.title === 'string') {
          state.title = data.title.slice(0, 512)
        }

        callback.current(state)
      } else if (data.type === 'error') {
        fail(typeof data.error === 'string' ? data.error.slice(0, 512) : 'Isolated browser unavailable')
      }
    }

    window.addEventListener('message', receive)

    void (async () => {
      try {
        const grant = await hostApi<ProxyGrant>({
          path: '/api/browser-proxy/bootstrap',
          method: 'POST',
          profile: getApiRequestProfile() ?? undefined
        })

        if (disposed) {
          return
        }

        const origin = new URL(grant.origin)
        const devSameOrigin = grant.sameOrigin === true && grant.path === '/browser-proxy/'

        if (
          origin.protocol !== 'https:' ||
          (origin.hostname === window.location.hostname && !devSameOrigin) ||
          origin.origin !== grant.origin ||
          origin.username ||
          origin.password ||
          !/^[A-Za-z0-9_-]{20,128}$/.test(grant.ticket)
        ) {
          throw new Error('Browser proxy requires a separate HTTPS hostname and origin')
        }

        // Cached/offline PWA HTML may predate the server's frame policy. Apply
        // the same restriction before mounting any untrusted iframe. It stays
        // for this document's lifetime: allowing 'self' would let the proxy
        // navigate back into Hermes and acquire the parent's origin.
        const policy = `frame-src ${origin.origin} blob: data:; object-src 'none'`
        const meta = document.createElement('meta')
        meta.httpEquiv = 'Content-Security-Policy'
        meta.content = policy
        document.head.append(meta)
        originRef.current = origin.origin
        setSharedOrigin(devSameOrigin)
        setSrc(`${origin.origin}${devSameOrigin ? '/browser-proxy/' : '/'}#ticket=${encodeURIComponent(grant.ticket)}`)
        timeout = setTimeout(
          () => fail('Isolated browser startup timed out. Check the proxy hostname and reconnect.'),
          30_000
        )
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : 'Isolated browser unavailable')
      }
    })()

    return () => {
      disposed = true
      ready.current = false
      originRef.current = ''
      clearTimeout(timeout)
      window.removeEventListener('message', receive)
    }
  }, [connection, profile, retry])

  return (
    <div className="absolute inset-0 flex flex-col bg-white text-black">
      {sharedOrigin && <p className="shrink-0 bg-amber-100 px-2 py-1 text-xs text-amber-950">Development mode: browsing shares Hermes’s origin.</p>}
      {src ? (
        <iframe
          allow="autoplay; encrypted-media"
          className="min-h-0 w-full flex-1 border-0"
          key={src}
          ref={iframe}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms"
          src={src}
          title="Isolated browser"
        />
      ) : (
        !error && <p className="p-3 text-sm">Connecting to isolated browser...</p>
      )}
      {error && (
        <div className="shrink-0 bg-background p-2 text-xs text-foreground" role="alert">
          {error}{' '}
          <button onClick={() => setRetry(value => value + 1)} type="button">
            Reconnect
          </button>
        </div>
      )}
    </div>
  )
})
