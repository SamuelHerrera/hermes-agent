// Quitting with a turn in flight kills the backend mid-tool-call: the work is
// lost, and anything the agent had half-written to disk stays half-written.
// Renderers publish what they're running; the main process asks before it lets
// that go. The decision + copy live here (pure, testable) so main.ts only owns
// the IPC and the dialog call.

const MAX_LISTED = 4

export interface ActiveWork {
  /** Titles of sessions running a turn. Untitled sessions contribute a count only. */
  titles: string[]
  /** Running turns, including untitled ones — always >= titles.length. */
  count: number
}

export const NO_ACTIVE_WORK: ActiveWork = { count: 0, titles: [] }

/** Coerce an IPC payload from an untrusted renderer into an ActiveWork. */
export function normalizeActiveWork(payload: unknown): ActiveWork {
  if (!payload || typeof payload !== 'object') {
    return NO_ACTIVE_WORK
  }

  const raw = payload as { count?: unknown; titles?: unknown }

  const titles = Array.isArray(raw.titles)
    ? raw.titles
        .filter((title): title is string => typeof title === 'string')
        .map(title => title.trim())
        .filter(Boolean)
    : []

  const count = typeof raw.count === 'number' && Number.isFinite(raw.count) ? Math.max(0, Math.floor(raw.count)) : 0

  return { count: Math.max(count, titles.length), titles }
}

/** Merge every window's report into one. Windows can show the same session. */
export function mergeActiveWork(reports: Iterable<ActiveWork>): ActiveWork {
  const titles: string[] = []
  let count = 0

  for (const report of reports) {
    count = Math.max(count, report.count)

    for (const title of report.titles) {
      if (!titles.includes(title)) {
        titles.push(title)
      }
    }
  }

  return { count: Math.max(count, titles.length), titles }
}

export interface QuitPrompt {
  buttons: string[]
  destructiveButtonIndex: number
  detachButtonIndex: number | null
  detail: string
  message: string
}

export interface QuitPromptOptions {
  canDetach?: boolean
}

/**
 * The confirmation to show, or null when quitting should just proceed.
 *
 * `quittingForHandoff` covers the update / swap / uninstall relaunches: those
 * are the app replacing itself, not the user walking away, and a modal there
 * would strand the detached script waiting on a PID that never exits.
 */
export function quitPromptFor(
  work: ActiveWork,
  quittingForHandoff: boolean,
  options: QuitPromptOptions = {}
): null | QuitPrompt {
  if (quittingForHandoff || work.count < 1) {
    return null
  }

  const listed = work.titles.slice(0, MAX_LISTED)
  const remaining = work.count - listed.length
  const lines = listed.map(title => `• ${title}`)

  if (remaining > 0) {
    lines.push(remaining === 1 ? '• 1 more' : `• ${remaining} more`)
  }

  const canDetach = options.canDetach === true
  const tail = canDetach
    ? 'You can quit the Desktop UI and keep this work running in the local backend. Reopen Hermes later to reconnect and check progress. “Stop Work and Quit” still stops it mid-turn.'
    : 'Quitting stops the agent mid-turn. Any work it has not finished writing is lost.'

  return {
    buttons: canDetach ? ['Keep Open', 'Quit UI, Keep Work Running', 'Stop Work and Quit'] : ['Keep Running', 'Quit Anyway'],
    destructiveButtonIndex: canDetach ? 2 : 1,
    detachButtonIndex: canDetach ? 1 : null,
    detail: [
      lines.join('\n'),
      lines.length > 0 ? '' : null,
      tail
    ]
      .filter(line => line !== null)
      .join('\n')
      .trim(),
    message: work.count === 1 ? 'Hermes is still working on 1 chat.' : `Hermes is still working on ${work.count} chats.`
  }
}
