import path from 'node:path'

import { ensureHost } from '../../../packages/terminal-host/src/install.mjs'
import { openSession } from '../../../packages/terminal-host/src/session-client.mjs'

/** The host credentials never cross IPC. Only this window-scoped handle does. */
export async function openLocalPersistentTerminal(options: {
  bundle: string
  home: string
  profile: string
  requestId: string
  reference?: { scope: string; epoch: string; terminalId: string }
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}) {
  const scope = `local/${options.profile}`
  const client = await ensureHost({
    bundle: options.bundle,
    versions: path.join(options.home, 'terminal-host', 'versions'),
    directory: path.join(options.home, 'terminal-host', 'runtime')
  })
  return openSession(client, {
    scope,
    reference: options.reference,
    requestId: options.requestId,
    spawn: { file: options.file, args: options.args, cwd: options.cwd, env: options.env, cols: options.cols, rows: options.rows }
  })
}
