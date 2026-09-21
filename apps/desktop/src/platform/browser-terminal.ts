import type { HermesSharedTerminal, HermesTerminalMetadata, HermesTerminalReference } from '@/global'

import { openSession } from '../../../../packages/terminal-host/src/session-client.mjs'

import type { HermesHost } from './types'

type TerminalApi = NonNullable<NonNullable<Window['hermesDesktop']>['terminal']>
type PersistentSession = Awaited<ReturnType<typeof openSession>>

interface LiveHandle {
  session: PersistentSession
  socket: WebSocket
}

function backendIdentity(connection: Awaited<ReturnType<HermesHost['getConnection']>>): string {
  const authority = connection.remoteIdentity || connection.remoteHost || connection.baseUrl || ''

  return [connection.mode || '', connection.remoteKind || '', authority].join('\u0000')
}

function terminalUrl(wsUrl: string): string {
  const url = new URL(wsUrl)
  url.pathname = url.pathname.replace(/\/api\/ws$/, '/api/persistent-terminal')

  return url.toString()
}

function resultUrl(value: Awaited<ReturnType<HermesHost['getGatewayWsUrl']>>): string {
  if (typeof value === 'string') {
    return value
  }

  if (value.ok) {
    return value.wsUrl
  }
  throw new Error(value.error || 'Persistent terminal authentication failed.')
}

async function connect(host: HermesHost, profile: string | undefined): Promise<{
  client: { epoch: string; request(method: string, params: unknown): Promise<any> }
  socket: WebSocket
  scope: string
}> {
  const socket = new WebSocket(terminalUrl(resultUrl(await host.getGatewayWsUrl(profile))))
  let counter = 0
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()

  return new Promise((resolve, reject) => {
    let settled = false
    const handshakeTimer = setTimeout(() => fail(new Error('Persistent terminal handshake timed out.')), 15_000)

    const fail = (error: Error) => {
      const handshakeComplete = settled

      if (!settled) {
        settled = true
      }
      clearTimeout(handshakeTimer)

      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }

      pending.clear()

      if (!handshakeComplete) {
        if (socket.readyState === 0 || socket.readyState === 1) {
          socket.close()
        }

        reject(error)
      }
    }

    const client = {
      epoch: '',
      request(method: string, params: unknown): Promise<any> {
        return new Promise((resolveRequest, rejectRequest) => {
          if (socket.readyState !== 1) {
            return rejectRequest(new Error('DISCONNECTED'))
          }

          if (pending.size >= 128) {
            return rejectRequest(new Error('REQUEST_LIMIT'))
          }
          const id = ++counter

          const timer = setTimeout(() => {
            pending.delete(id)
            rejectRequest(new Error('REQUEST_TIMEOUT'))
          }, 12_000)

          pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
          socket.send(JSON.stringify({ id, method, params }))
        })
      }
    }

    socket.addEventListener('message', event => {
      let frame: any

      try {
        frame = JSON.parse(String(event.data))
      } catch {
        socket.close()
        fail(new Error('Persistent terminal returned invalid JSON.'))

        return
      }

      if (frame.type === 'ready') {
        if (settled) {
          return
        }

        if (frame.protocol !== 2 || typeof frame.scope !== 'string' || typeof frame.epoch !== 'string') {
          fail(new Error('Persistent terminal protocol is unsupported.'))
          socket.close()

          return
        }

        settled = true
        clearTimeout(handshakeTimer)
        client.epoch = frame.epoch
        resolve({ client, socket, scope: frame.scope })

        return
      }

      const waiter = pending.get(frame.id)

      if (!waiter) {
        return
      }
      pending.delete(frame.id)
      clearTimeout(waiter.timer)

      if (frame.error) {
        waiter.reject(new Error(String(frame.error)))
      } else {
        waiter.resolve(frame.result)
      }
    })
    socket.addEventListener('close', () => fail(new Error('Persistent terminal disconnected; the shell was not restarted.')))
    socket.addEventListener('error', () => fail(new Error('Persistent terminal connection failed; the shell was not restarted.')))
  })
}

export function createBrowserTerminal(host: HermesHost): TerminalApi {
  if (!host.capabilities.persistentTerminal) {
    throw new Error('Persistent terminal is unsupported by this backend.')
  }
  const handles = new Map<string, LiveHandle>()
  let nextHandle = 0

  const handle = (id: string) => {
    const live = handles.get(id)

    if (!live) {throw new Error('TERMINAL_SESSION_MISSING')}

    return live
  }

  return {
    persistent: true,
    async list(options = {}) {
      const profile = options.profile || undefined
      const connection = await host.getConnection(profile)
      const identity = backendIdentity(connection)
      const { client, socket, scope } = await connect(host, profile)

      try {
        const result = await client.request('list', { scope }) as { metadataVersion?: number; sessions?: Array<{
          epoch: string
          metadata?: HermesTerminalMetadata
          pid: number
          terminalId: string
        }> }

        if (result.metadataVersion !== 1) {
          throw new Error('SHARED_TERMINALS_UNSUPPORTED')
        }

        if ((result.sessions ?? []).some(entry => !entry.metadata?.id)) {
          throw new Error('SHARED_TERMINALS_INCOMPLETE')
        }

        return (result.sessions ?? [])
          .filter((entry): entry is typeof entry & { metadata: HermesTerminalMetadata } => Boolean(entry.metadata?.id))
          .map(entry => ({
            metadata: entry.metadata,
            pid: entry.pid,
            reference: {
              backendIdentity: identity,
              epoch: entry.epoch || client.epoch,
              profile: profile || 'default',
              scope,
              terminalId: entry.terminalId
            }
          } satisfies HermesSharedTerminal))
      } finally {
        socket.close()
      }
    },
    async updateShared(options) {
      const profile = options.profile || undefined
      const connection = await host.getConnection(profile)
      const identity = backendIdentity(connection)

      if (
        (options.reference.backendIdentity && options.reference.backendIdentity !== identity) ||
        (options.reference.profile && options.reference.profile !== (profile || 'default')) ||
        (!options.reference.backendIdentity && options.reference.scope !== `profile/${profile || 'default'}`)
      ) {
        throw new Error('HOST_LOST')
      }

      const { client, socket, scope } = await connect(host, profile)

      try {
        await client.request('update', { ...options.reference, scope, metadata: options.metadata })
        return true
      } finally {
        socket.close()
      }
    },
    async start(options = {}) {
      const profile = options.profile || undefined
      const connection = await host.getConnection(profile)
      const identity = backendIdentity(connection)

      if (options.reference && (
        !options.reference.backendIdentity ||
        options.reference.backendIdentity !== identity ||
        (options.reference.profile || 'default') !== (profile || 'default')
      )) {
        throw new Error('HOST_LOST')
      }

      const { client, socket, scope } = await connect(host, profile)

      try {
        const session = await openSession(client, {
          scope,
          reference: options.reference,
          requestId: options.requestId || crypto.randomUUID(),
          spawn: { cols: options.cols, rows: options.rows, cwd: options.cwd, metadata: options.metadata }
        })

        const id = `browser-terminal-${++nextHandle}`
        handles.set(id, { session, socket })

        return {
          cwd: options.cwd ?? null,
          id,
          reference: {
            ...(session.reference as HermesTerminalReference),
            backendIdentity: identity,
            profile: profile || 'default'
          },
          shell: 'shell',
          snapshot: session.snapshot
        }
      } catch (error) {
        socket.close()
        throw error
      }
    },
    read: (id, after) => handle(id).session.read(after),
    checkpoint: id => handle(id).session.checkpoint(),
    write: async (id, data) => Boolean(await handle(id).session.input(data)),
    resize: async (id, size) => Boolean(await handle(id).session.resize(size)),
    terminate: id => handle(id).session.terminate(),
    async dispose(id) {
      const live = handles.get(id)

      if (!live) {return false}
      handles.delete(id)

      try {
        await live.session.detach()
      } finally {
        live.socket.close()
      }

      return true
    },
    attach: async id => handles.has(id),
    cwd: async () => null,
    process: async () => null,
    onData: () => () => undefined,
    onExit: () => () => undefined
  }
}
