import http from 'node:http'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { server as wisp, logging } from '@mercuryworkshop/wisp-js/server'
import { scramjetPath } from '@mercuryworkshop/scramjet/path'
import { TargetPolicy } from './security.mjs'
import { getDomain } from 'tldts'

logging.set_level(logging.NONE)
const publicPath = fileURLToPath(new URL('./public/', import.meta.url))
const mime = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.html': 'text/html',
  '.json': 'application/json',
  '.css': 'text/css'
}
const token = () => randomBytes(32).toString('base64url')

export function validateOriginPair(parentOrigin, proxyOrigin, testOnly = false) {
  const parent = new URL(parentOrigin), origin = new URL(proxyOrigin)
  if (parent.origin === origin.origin || parent.hostname === origin.hostname ||
      ((parent.protocol !== 'https:' || origin.protocol !== 'https:') && !testOnly))
    throw new Error('Origin isolation required')
  const parentSite = getDomain(parent.hostname, { allowPrivateDomains: true }),
    proxySite = getDomain(origin.hostname, { allowPrivateDomains: true })
  if (!testOnly && (!parentSite || !proxySite || parentSite === proxySite))
    throw new Error('Separate registrable proxy domain required')
  return parent
}

export async function createProxy(config) {
  if (config.debug) logging.set_level(logging.DEBUG)
  const origin = new URL(config.origin)
  if (origin.protocol !== 'https:' && !config.testOnly) throw new Error('HTTPS proxy required')
  const tickets = new Map(),
    sessions = new Map()
  const policy = new TargetPolicy([origin.hostname, ...(config.deniedHosts || [])])
  const ticketTTL = config.ticketTTL || 30_000,
    sessionTTL = config.sessionTTL || 3_600_000
  const sockets = new Set()
  const MAX_SESSIONS = 8
  let closed = false
  Object.assign(wisp.options, {
    allow_udp_streams: false,
    allow_direct_ip: false,
    allow_private_ips: false,
    allow_loopback_ips: false,
    port_whitelist: [80, 443],
    stream_limit_total: 64,
    stream_limit_per_host: -1,
    dns_method: name => policy.resolve(name, 443),
    dns_ttl: 0
  })
  class CheckedSocket {
    constructor(hostname, port) {
      this.hostname = hostname
      this.port = port
      this.socket = null
      this.closed = false
    }
    async connect() {
      const address = await policy.resolve(this.hostname, this.port)
      if (this.closed) throw new Error('Closed')
      const socket = net.createConnection({ host: address, port: this.port })
      this.socket = socket
      socket.on('error', () => {})
      socket.setTimeout(30_000, () => socket.destroy())
      await once(socket, 'connect')
      if (this.closed) {
        socket.destroy()
        throw new Error('Closed')
      }
      socket.setTimeout(120_000, () => socket.destroy())
      this.iterator = socket[Symbol.asyncIterator]()
    }
    async recv() {
      const next = await this.iterator.next()
      return next.done ? null : next.value
    }
    async send(data) {
      if (!this.socket || this.closed) throw new Error('Closed')
      await new Promise((resolve, reject) => this.socket.write(data, error => (error ? reject(error) : resolve())))
    }
    async close() {
      this.closed = true
      this.socket?.destroy()
    }
    pause() {}
    resume() {}
  }
  const respond = (res, status, value, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type })
    res.end(type === 'application/json' ? JSON.stringify(value) : value)
  }
  const validHost = req => req.headers.host === origin.host
  const reap = () => {
    const now = Date.now()
    for (const [id, ticket] of tickets) if (ticket.expires <= now) tickets.delete(id)
    for (const [id, session] of sessions)
      if (session.expires <= now) {
        for (const ws of session.sockets) ws.terminate()
        sessions.delete(id)
      }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
    // Browser-native network, forms and frames cannot target Hermes even if
    // a hostile site evades Scramjet rewriting. Wisp checks every TCP stream.
    const ancestors = [...new Set([...tickets.values(), ...sessions.values()].map(grant => grant.parentOrigin))].join(
      ' '
    )
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data:; frame-src 'self'; worker-src 'self' blob:; form-action 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self' ${ancestors}`
    )
    if (!validHost(req)) return respond(res, 403, { error: 'Host rejected' })
    try {
      const url = new URL(req.url, origin)
      if (url.pathname === '/bootstrap' && req.method === 'POST') {
        if (req.headers.origin !== origin.origin) return respond(res, 403, { error: 'Origin rejected' })
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (body.length > 2048) return respond(res, 413, { error: 'Body too large' })
        }
        reap()
        const ticket = JSON.parse(body).ticket,
          grant = tickets.get(ticket)
        tickets.delete(ticket)
        if (!grant || sessions.size >= MAX_SESSIONS)
          return respond(res, 401, { error: 'Capability expired or consumed' })
        const id = token()
        sessions.set(id, { expires: Date.now() + sessionTTL, parentOrigin: grant.parentOrigin, sockets: new Set() })
        // This cookie is optional. Cross-site iframe clients use the returned
        // proxy-only bounded session in the Wisp URL, never a Hermes token.
        res.setHeader(
          'Set-Cookie',
          `__Host-HermesProxy=${id}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=${Math.floor(sessionTTL / 1000)}`
        )
        return respond(res, 200, { session: id, parentOrigin: grant.parentOrigin, expiresIn: sessionTTL })
      }
      if (url.pathname === '/release' && req.method === 'POST') {
        if (req.headers.origin !== origin.origin) return respond(res, 403, { error: 'Origin rejected' })
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (body.length > 2048) return respond(res, 413, { error: 'Body too large' })
        }
        const id = JSON.parse(body).session,
          session = sessions.get(id)
        if (session) {
          for (const ws of session.sockets) ws.terminate()
          sessions.delete(id)
        }
        return respond(res, 200, { ok: true })
      }
      if (req.method !== 'GET') return respond(res, 405, { error: 'Method rejected' })
      const roots = {
        '/assets/scram/': scramjetPath,
        '/assets/controller/': path.dirname(fileURLToPath(import.meta.resolve('@mercuryworkshop/scramjet-controller'))),
        '/assets/utils/': path.dirname(fileURLToPath(import.meta.resolve('@mercuryworkshop/scramjet-utils'))),
        '/assets/libcurl/': path.dirname(fileURLToPath(import.meta.resolve('@mercuryworkshop/libcurl-transport')))
      }
      let root = publicPath,
        suffix = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      for (const [prefix, dir] of Object.entries(roots))
        if (url.pathname.startsWith(prefix)) {
          root = dir
          suffix = url.pathname.slice(prefix.length)
          break
        }
      const filename = path.resolve(root, suffix)
      if (!filename.startsWith(path.resolve(root) + path.sep)) return respond(res, 403, { error: 'Path rejected' })
      const bytes = await readFile(filename)
      if (url.pathname === '/sw.js') res.setHeader('Service-Worker-Allowed', '/')
      return respond(res, 200, bytes, mime[path.extname(filename)] || 'application/octet-stream')
    } catch {
      return respond(res, 404, { error: 'Unavailable' })
    }
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.maxConnections = 128
  server.maxRequestsPerSocket = 128
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 1_048_576, perMessageDeflate: false })
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {})
    reap()
    let url
    try {
      url = new URL(req.url, origin)
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      return
    }
    const match = /^\/wisp\/([A-Za-z0-9_-]{43})\/$/.exec(url.pathname)
    const session = match && sessions.get(match[1])
    if (!validHost(req) || req.headers.origin !== origin.origin || !session || session.sockets.size >= 4) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    wsServer.handleUpgrade(req, socket, head, ws => {
      sockets.add(ws)
      session.sockets.add(ws)
      ws.once('close', () => {
        sockets.delete(ws)
        session.sockets.delete(ws)
      })
      let queuedBytes = 0
      class ConnectionSocket extends CheckedSocket {
        async send(data) {
          try {
            await super.send(data)
          } finally {
            queuedBytes -= data.byteLength
          }
        }
      }
      class BoundedConnection extends wisp.ServerConnection {
        route_packet(buffer) {
          // The library queues DATA asynchronously. Enforce a byte budget
          // before it can accumulate pending puts against a blocked socket.
          if (buffer.size < 5) {
            ws.terminate()
            return
          }
          if (buffer.bytes[0] === 2) {
            const stream = this.streams[buffer.view.getUint32(1, true)]
            const bytes = buffer.size - 5
            if (!stream || stream.send_buffer.size >= 128 || queuedBytes + bytes > 4 * 1024 * 1024) {
              ws.terminate()
              return
            }
            queuedBytes += bytes
          }
          super.route_packet(buffer)
        }
        create_stream(id, type, hostname, port) {
          // Reject unknown/UDP stream types and duplicate IDs before the
          // library allocates sockets. Duplicate IDs otherwise orphan the old
          // stream, escaping its per-connection limit and cleanup registry.
          if (type !== 1 || !id || this.streams[id] || Object.keys(this.streams).length >= 64) {
            ws.terminate()
            return
          }
          void super.create_stream(id, type, hostname, port).catch(() => ws.terminate())
        }
      }
      const connection = new BoundedConnection(ws, '/wisp/', { TCPSocket: ConnectionSocket, wisp_version: 1 })
      const handshake = setTimeout(() => ws.terminate(), 10_000)
      void (async () => {
        try {
          await connection.setup()
          clearTimeout(handshake)
          await connection.run()
        } catch {
          ws.terminate()
          await connection.cleanup()
        } finally {
          clearTimeout(handshake)
        }
      })()
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port ?? 0, config.listenHost || '127.0.0.1', resolve)
  })
  const timer = setInterval(reap, Math.min(1000, sessionTTL))
  timer.unref()
  return {
    port: server.address().port,
    sessions,
    async mint(parentOrigin, resolveManagement = true) {
      reap()
      const parent = validateOriginPair(parentOrigin, origin.origin, config.testOnly)
      if (tickets.size + sessions.size >= MAX_SESSIONS) throw new Error('Proxy capacity reached')
      if (resolveManagement) {
        await policy.denyHost(parent.hostname)
        await policy.denyHost(origin.hostname)
        for (const name of config.deniedHosts || []) await policy.denyHost(name)
      }
      const id = token()
      tickets.set(id, { parentOrigin: parent.origin, expires: Date.now() + ticketTTL })
      return { ticket: id, origin: origin.origin, expiresIn: ticketTTL }
    },
    async close() {
      if (closed) return
      closed = true
      clearInterval(timer)
      for (const ws of sockets) ws.terminate()
      tickets.clear()
      sessions.clear()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      wsServer.close()
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let proxy
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  // Commands only enter through inherited stdio, never an HTTP admin route.
  for await (const line of lines) {
    try {
      const command = JSON.parse(line)
      if (!proxy) {
        proxy = await createProxy(command)
        console.log(JSON.stringify({ type: 'ready', port: proxy.port }))
      } else if (command.type === 'mint')
        console.log(JSON.stringify({ id: command.id, ...(await proxy.mint(command.parentOrigin)) }))
      else if (command.type === 'stop') break
    } catch {
      console.log(JSON.stringify({ error: 'Proxy startup or capability unavailable' }))
    }
  }
  await proxy?.close()
}
