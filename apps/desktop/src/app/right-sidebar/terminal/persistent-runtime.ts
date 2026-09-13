import type { Terminal } from '@xterm/xterm'
import runtimeUrl from '@xterm/xterm/lib/xterm.js?url'

export { hydrateTerminalState } from '../../../../../../packages/terminal-host/src/xterm-state-v1.mjs'

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
