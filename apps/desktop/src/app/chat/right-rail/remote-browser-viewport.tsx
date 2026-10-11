import { useStore } from '@nanostores/react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { getApiRequestProfile } from '@/hermes'
import { resolveHost } from '@/platform/host'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'

export interface RemoteBrowserHandle {
  send(command: Record<string, unknown>): void
}

export const RemoteBrowserViewport = forwardRef<
  RemoteBrowserHandle,
  {
    initialUrl: string
    onState(value: { url?: string; title?: string; loading?: boolean }): void
  }
>(function RemoteBrowserViewport({ initialUrl, onState }, ref) {
  const connection = useStore($connection)
  const profile = useStore($activeGatewayProfile)
  const container = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const ready = useRef(false)
  const pending = useRef<Record<string, unknown>[]>([])
  const stateCallback = useRef(onState)
  stateCallback.current = onState
  const initial = useRef(initialUrl)
  const [image, setImage] = useState('')
  const [size, setSize] = useState({ width: 1024, height: 768 })
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [showKeyboard, setShowKeyboard] = useState(false)
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const send = (command: Record<string, unknown>) => {
    if (command.type === 'navigate' && typeof command.url === 'string') {
      initial.current = command.url
    }

    if (ready.current && socketRef.current?.readyState === 1) {
      socketRef.current.send(JSON.stringify(command))
    } else if (pending.current.length < 32) {
      pending.current.push(command)
    }
  }

  useImperativeHandle(ref, () => ({ send }))

  // This effect owns transport resources (socket/ready), not atom mirrors.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let observer: ResizeObserver | null = null
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined
    let lastLocation = ''

    const publishLocation = (frame: { url?: string; title?: string }, force = false) => {
      const location = JSON.stringify([frame.url, frame.title])

      if (location !== lastLocation) {
        lastLocation = location

        if (frame.url && (frame.url !== 'about:blank' || initial.current === 'about:blank')) {
          initial.current = frame.url
        }

        stateCallback.current({ url: frame.url, title: frame.title, loading: false })
      } else if (force) {
        stateCallback.current({ loading: false })
      }
    }

    ready.current = false
    setImage('')
    setError('')
    stateCallback.current({ loading: true })

    const fail = (message: string) => {
      if (disposed) {
        return
      }

      setError(message)
      stateCallback.current({ loading: false })
    }

    const resize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const bounds = container.current?.getBoundingClientRect()

        if (bounds && socket?.readyState === 1 && ready.current) {
          socket.send(
            JSON.stringify({
              type: 'resize',
              width: Math.max(160, Math.min(1920, Math.round(bounds.width))),
              height: Math.max(160, Math.min(1920, Math.round(bounds.height)))
            })
          )
        }
      }, 150)
    }
    void (async () => {
      try {
        const value = await resolveHost().getGatewayWsUrl(getApiRequestProfile())

        if (disposed) {
          return
        }

        const url = new URL(
          typeof value === 'string'
            ? value
            : value.ok
              ? value.wsUrl
              : (() => {
                  throw new Error(value.error)
                })()
        )

        if (!url.pathname.endsWith('/api/ws')) {
          throw new Error('Invalid backend WebSocket address')
        }

        url.pathname = url.pathname.replace(/\/api\/ws$/, '/api/remote-browser')
        socket = new WebSocket(url.toString())
        socketRef.current = socket
        handshakeTimer = setTimeout(() => {
          fail('Remote browser startup timed out')
          socket?.close()
        }, 35_000)
        socket.addEventListener('message', event => {
          if (disposed) {
            return
          }

          try {
            const frame = JSON.parse(String(event.data))

            if (frame.type === 'ready' && frame.protocol === 1) {
              clearTimeout(handshakeTimer)
              ready.current = true
              socket?.send(JSON.stringify({ type: 'navigate', url: initial.current }))

              for (const command of pending.current.splice(0)) {
                // initial.current already contains the latest queued address.
                if (command.type !== 'navigate') {
                  socket?.send(JSON.stringify(command))
                }
              }

              resize()
            } else if (frame.type === 'frame') {
              // Only decoded raster bytes cross this trust boundary, never HTML.
              if (
                typeof frame.image !== 'string' ||
                !/^[A-Za-z0-9+/=]+$/.test(frame.image) ||
                frame.image.length > 8_000_000
              ) {
                throw new Error('Invalid frame')
              }

              setImage(`data:image/jpeg;base64,${frame.image}`)
              socket?.send(JSON.stringify({ type: 'ack' }))
              setSize({ width: frame.width, height: frame.height })
              publishLocation(frame)
            } else if (frame.type === 'state') {
              publishLocation(frame, true)
              setError('')
            } else if (frame.type === 'error') {
              fail(frame.error || 'Remote browser action failed')
            }
          } catch {
            fail('Invalid remote browser response')
            socket?.close()
          }
        })
        socket.addEventListener('close', event => {
          clearTimeout(handshakeTimer)
          ready.current = false
          fail(`Remote browser disconnected (${event.code}). Reconnect to start a fresh private session.`)
        })
        socket.addEventListener('error', () => fail('Remote browser unavailable on this backend'))
        observer = new ResizeObserver(resize)

        if (container.current) {
          observer.observe(container.current)
        }
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : 'Remote browser unavailable')
      }
    })()

    return () => {
      disposed = true
      ready.current = false
      pending.current = []
      clearTimeout(resizeTimer)
      clearTimeout(handshakeTimer)
      observer?.disconnect()
      socket?.close()
      socketRef.current = null
    }
  }, [connection, profile, retry])

  useEffect(() => {
    const element = container.current

    if (!element) {
      return
    }

    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      send({
        type: 'scroll',
        deltaX: Math.max(-3000, Math.min(3000, event.deltaX)),
        deltaY: Math.max(-3000, Math.min(3000, event.deltaY))
      })
    }

    element.addEventListener('wheel', wheel, { passive: false })

    return () => element.removeEventListener('wheel', wheel)
  })

  const key = (event: React.KeyboardEvent) => {
    if (event.key === 'Unidentified' || event.key === 'Process') {
      return
    }

    event.preventDefault()

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      send({ type: 'type', text: event.key })
    } else if (!['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) {
      send({
        type: 'key',
        key: [
          event.ctrlKey && 'Control',
          event.metaKey && 'Meta',
          event.altKey && 'Alt',
          event.shiftKey && 'Shift',
          event.key === ' ' ? 'Space' : event.key
        ]
          .filter(Boolean)
          .join('+')
      })
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-white text-black">
      <div
        aria-label="Remote browser viewport"
        className="relative min-h-0 flex-1 overflow-hidden outline-none"
        onContextMenu={event => event.preventDefault()}
        onKeyDown={key}
        onPointerCancel={() => {
          gesture.current = null
        }}
        onPointerDown={event => {
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          gesture.current = { x: event.clientX, y: event.clientY, moved: false }
        }}
        onPointerMove={event => {
          const start = gesture.current

          if (!start || event.pointerType === 'mouse') {
            return
          }

          const deltaY = start.y - event.clientY

          if (Math.abs(deltaY) > 5 || start.moved) {
            send({ type: 'scroll', deltaX: 0, deltaY })
            gesture.current = { x: event.clientX, y: event.clientY, moved: true }
          }
        }}
        onPointerUp={event => {
          if (gesture.current && !gesture.current.moved) {
            const bounds = event.currentTarget.getBoundingClientRect()
            send({
              type: 'click',
              x: ((event.clientX - bounds.left) * size.width) / bounds.width,
              y: ((event.clientY - bounds.top) * size.height) / bounds.height,
              button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left'
            })
          }

          gesture.current = null
        }}
        ref={container}
        role="application"
        style={{ touchAction: 'none' }}
        tabIndex={0}
      >
        {image && (
          <img alt="Backend browser page" className="absolute inset-0 size-full" draggable={false} src={image} />
        )}
        {!image && !error && <p className="p-3 text-sm">Connecting to backend browser…</p>}
      </div>
      {error && (
        <div className="shrink-0 bg-background p-2 text-xs text-foreground" role="alert">
          {error}{' '}
          <button onClick={() => setRetry(value => value + 1)} type="button">
            Reconnect
          </button>
        </div>
      )}
      <div className="flex shrink-0 gap-2 border-t bg-background p-1 text-xs text-foreground">
        <button onClick={() => setShowKeyboard(value => !value)} type="button">
          Keyboard
        </button>
        {showKeyboard && (
          <input
            aria-label="Type into remote page"
            autoComplete="off"
            className="min-w-0 flex-1 border px-1"
            onChange={event => {
              if (event.currentTarget.value) {
                send({ type: 'type', text: event.currentTarget.value })
              }

              event.currentTarget.value = ''
            }}
            onKeyDown={event => {
              if (['Enter', 'Backspace', 'Tab', 'Escape'].includes(event.key)) {
                event.preventDefault()
                send({ type: 'key', key: event.key })
              }
            }}
            placeholder="Type into page"
          />
        )}
        {showKeyboard && (
          <button onClick={() => send({ type: 'key', key: 'Enter' })} type="button">
            Enter
          </button>
        )}
      </div>
    </div>
  )
})
