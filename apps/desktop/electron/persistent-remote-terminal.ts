import { openSession } from '../../../packages/terminal-host/src/session-client.mjs'

export async function openRemotePersistentTerminal(url: string, options: { reference?: { scope: string; epoch: string; terminalId: string }; requestId: string; cols: number; rows: number; cwd?: string }) {
  const socket = new WebSocket(url)
  let counter = 0
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const ready = await new Promise<{ epoch: string; scope: string }>((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Persistent terminal host handshake timed out.')) }, 15000)
    socket.addEventListener('message', event => {
      try {
        const frame = JSON.parse(String(event.data))
        if (frame.type === 'ready' && frame.protocol === 2) {
          clearTimeout(timer)
          resolve(frame)
          return
        }
        const waiter = pending.get(frame.id)
        if (!waiter) { return }
        pending.delete(frame.id)
        clearTimeout(waiter.timer)
        if (frame.error) { waiter.reject(new Error(frame.error)) }
        else { waiter.resolve(frame.result) }
      } catch { socket.close() }
    })
    const fail = () => {
      clearTimeout(timer)
      const error = new Error('Persistent terminal disconnected. Install/start the host on its owner backend; the shell was not restarted.')
      reject(error)
      for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error) }
      pending.clear()
    }
    socket.addEventListener('close', fail)
    socket.addEventListener('error', fail)
  }).catch(error => {
    socket.close()
    // Before the greeting no create/attach request has been sent. Only new
    // tabs may use the legacy transport; saved identities never respawn.
    if (!options.reference) { return null }
    throw error
  })
  if (!ready) { return null }
  const client = {
    epoch: ready.epoch,
    request(method: string, params: unknown): Promise<any> {
      return new Promise((resolve, reject) => {
        if (socket.readyState !== 1) { return reject(new Error('DISCONNECTED')) }
        if (pending.size >= 128) { return reject(new Error('REQUEST_LIMIT')) }
        const id = ++counter
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('REQUEST_TIMEOUT')) }, 12000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    }
  }
  try {
    const session = await openSession(client, {
      scope: ready.scope, reference: options.reference, requestId: options.requestId,
      spawn: { cols: options.cols, rows: options.rows, cwd: options.cwd }
    })
    const detach = session.detach
    session.detach = async () => { try { return await detach() } finally { socket.close() } }
    return session
  } catch (error) { socket.close(); throw error }
}
