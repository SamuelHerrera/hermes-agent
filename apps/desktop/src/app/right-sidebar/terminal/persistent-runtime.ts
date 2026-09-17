import type { Terminal } from '@xterm/xterm'
import runtimeUrl from '@xterm/xterm/lib/xterm.js?url'

export { hydrateTerminalState } from '../../../../../../packages/terminal-host/src/xterm-state-v1.mjs'

/** xterm 6 emits onUserInput immediately before onData for keys, paste and mouse. */
export function onTerminalData(term: Terminal, listener: (data: string, userInput: boolean) => void) {
  const core = (term as unknown as {
    _core: { coreService: { onUserInput: (listener: () => void) => { dispose: () => void } } }
  })._core.coreService
  let userInput = false
  const input = core.onUserInput(() => { userInput = true })
  const data = term.onData(value => {
    const isUserInput = userInput
    userInput = false
    listener(value, isUserInput)
  })
  return { dispose: () => { input.dispose(); data.dispose() } }
}

let loading: Promise<typeof Terminal> | undefined

/** Keep the audited UMD engine byte-stable instead of rebundling private internals. */
export function loadPersistentTerminalRuntime(): Promise<typeof Terminal> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = runtimeUrl
    script.onload = () => {
      const runtime = (window as unknown as { Terminal?: typeof Terminal }).Terminal
      if (runtime) { resolve(runtime) }
      else { reject(new Error('Persistent terminal runtime did not load.')) }
    }
    script.onerror = () => reject(new Error('Persistent terminal runtime unavailable.'))
    document.head.append(script)
  })
  return loading
}
