/** A socket owns exactly one remote shell. No reconnect or local fallback. */
export async function openRemoteTerminal(url: string, WebSocketImpl = WebSocket) {
  const socket = new WebSocketImpl(url)
  socket.binaryType = 'arraybuffer'
  const decoder = new TextDecoder()
  let dataListener: ((data: string) => void) | undefined
  let exitListener: ((exit: { exitCode: number; signal: number }) => void) | undefined
  let pending = ''
  let ended = false
  let ready = false

  const emit = (data: string) => {
    if (dataListener) {
      dataListener(data)
    } else {
      pending = (pending + data).slice(-1024 * 1024)
    }
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => fail(), 15_000)

    const fail = () => {
      clearTimeout(timer)
      socket.close()
      reject(new Error('Remote terminal unavailable. The owner backend must support authenticated /api/terminal.'))
    }

    socket.addEventListener('message', event => {
      if (!ready) {
        try {
          const frame = JSON.parse(String(event.data))

          if (frame.type !== 'ready' || frame.protocol !== 1) {
            return fail()
          }
          ready = true
          clearTimeout(timer)
          resolve()
        } catch {
          fail()
        }

        return
      }

      emit(typeof event.data === 'string' ? event.data : decoder.decode(event.data, { stream: true }))
    })
    socket.addEventListener('error', () => {
      if (!ready) {
        fail()
      } else {
        socket.close()
      }
    })
    socket.addEventListener('close', () => {
      ended = true

      if (!ready) {
        fail()
      } else {
        emit(decoder.decode())
        exitListener?.({ exitCode: 0, signal: 0 })
      }
    })
  })

  return {
    write(data: string) {
      if (socket.readyState === 1) {
        socket.send(data)
      }
    },
    resize(cols: number, rows: number) {
      if (socket.readyState === 1) {
        socket.send(`\x1b[RESIZE:${cols};${rows}]`)
      }
    },
    kill() {
      socket.close()
    },
    onData(listener: (data: string) => void) {
      dataListener = listener

      if (pending) {
        listener(pending)
      }
      pending = ''
    },
    onExit(listener: (exit: { exitCode: number; signal: number }) => void) {
      exitListener = listener

      if (ended) {
        listener({ exitCode: 0, signal: 0 })
      }
    }
  }
}
