import { paneMirror } from '@/app/chat/pane-mirror'
import { Codicon } from '@/components/ui/codicon'

import { TerminalPaneChrome } from './chrome'
import { $openTerminals, $terminals, closeTerminalTab, type TerminalEntry } from './terminals'

/** One shell/process is one ordinary, movable workspace tab. */
export const watchTerminalPanes = paneMirror<TerminalEntry>({
  source: $openTerminals,
  key: terminal => terminal.id,
  prefix: 'terminal-instance',
  dir: () => 'center',
  minWidth: '12rem',
  title: id => $terminals.get().find(terminal => terminal.id === id)?.title ?? 'Terminal',
  tabLead: () => <Codicon name="terminal" size="0.875rem" />,
  render: id => <TerminalPaneChrome terminalId={id} />,
  close: closeTerminalTab
})
