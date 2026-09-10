import { TerminalSlot } from './persistent'

/** The pane owns geometry; its persistent xterm host follows this slot. */
export function TerminalPaneChrome({ terminalId }: { terminalId: string }) {
  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-(--ui-terminal-surface-background)">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <TerminalSlot terminalId={terminalId} />
      </div>
    </div>
  )
}
