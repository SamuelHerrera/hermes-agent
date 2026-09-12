import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { $backgroundStatusBySession } from '@/store/composer-status'
import { $sessions } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { seedAgentTerminalCommand, syncAgentTerminalSnapshot } from './agent-terminal-stream'
import { setActiveTerminalId } from './buffer'
import { PersistentTerminalHost } from './persistent'
import { $activeTerminalId, $terminals, ensureAgentTerminal } from './terminals'

interface TerminalWorkspaceProps {
  onAddSelectionToChat: (text: string, label?: string) => void
}

/** Persistent shell/process hosts, independently positioned over their pane
 *  slots. Removing a tab hides its host; removing an entry disposes it. */
export function TerminalWorkspace({ onAddSelectionToChat }: TerminalWorkspaceProps) {
  const terminals = useStore($terminals)
  const background = useStore($backgroundStatusBySession)

  // Mirror the tab selection into the agent reader (read_terminal reads it).
  useEffect(() => {
    const unsubscribe = $activeTerminalId.subscribe(setActiveTerminalId)

    return () => {
      unsubscribe()
      setActiveTerminalId(null)
    }
  }, [])

  // List background processes under their chats; tabs open only on user selection.
  // Live chunks stream via agent.terminal.output; the process-list snapshot also
  // seeds/falls back so the tab never stays blank if the stream races startup.
  useEffect(() => {
    for (const [runtimeId, list] of Object.entries(background)) {
      const state = $sessionStates.get()[runtimeId]
      const session = $sessions.get().find(session => session.id === (state?.storedSessionId ?? runtimeId))

      for (const item of list) {
        ensureAgentTerminal(item.id, item.title, {
          ownerSessionId: runtimeId,
          profile: session?.profile,
          cwd: session?.cwd ?? ''
        })
        seedAgentTerminalCommand(item.id, item.title)
        syncAgentTerminalSnapshot(item.id, item.output ?? '')
      }
    }
  }, [background])

  return (
    <>
      {terminals.map(term => (
        <PersistentTerminalHost key={term.id} onAddSelectionToChat={onAddSelectionToChat} terminal={term} />
      ))}
    </>
  )
}
