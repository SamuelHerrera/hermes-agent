/** Keep startup events until both renderer listeners exist, including an early exit. */
export function createTerminalDelivery(deliver: (kind: 'data' | 'exit', payload: unknown) => void) {
  let attached = false
  let pending = ''
  let exit: unknown

  return {
    send(kind: 'data' | 'exit', payload: unknown) {
      if (attached) {
        deliver(kind, payload)
      } else if (kind === 'data') {
        pending = (pending + String(payload)).slice(-1024 * 1024)
      } else {
        exit = payload
      }
    },
    attach() {
      if (attached) {
        return
      }

      attached = true

      if (pending) {
        deliver('data', pending)
        pending = ''
      }

      if (exit !== undefined) {
        deliver('exit', exit)
        exit = undefined
      }
    }
  }
}
