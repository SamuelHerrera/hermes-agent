// Native PTY foreground names work even for programs that emit no OSC title.
// Poll independently of output: quiet programs and hidden terminals still change.
export function watchTerminalProcess(
  read: () => Promise<string | null>,
  report: (name: string) => void,
  intervalMs = 1000
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous = ''

  const poll = async () => {
    try {
      const name = (await read())?.trim()

      if (!stopped && name && name !== previous) {
        previous = name
        report(name)
      }
    } catch {
      // Older/disconnected main processes must not interrupt a live shell.
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void poll(), intervalMs)
      }
    }
  }

  void poll()

  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
