import { useAuiState } from '@assistant-ui/react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'

export const INTERRUPTED_TURN_CONTINUE_PROMPT =
  'Continue the interrupted turn. Treat missing tool outcomes as UNKNOWN. Inspect current state before retrying any side-effecting operation; do not blindly repeat commands.'

/** Use the normal user-submit path, never replay a tool call directly. */
export function InterruptedTurnContinue({ onContinue }: { onContinue: (text: string) => Promise<boolean> | boolean }) {
  const running = useAuiState(state => state.thread.isRunning)
  const { t } = useI18n()

  return (
    <Button
      disabled={running}
      onClick={() => void Promise.resolve(onContinue(INTERRUPTED_TURN_CONTINUE_PROMPT))}
      size="sm"
      variant="outline"
    >
      {t.common.continue}
    </Button>
  )
}
