import { useAuiState, useThreadRuntime } from '@assistant-ui/react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'

/** Use the normal user-submit path, never replay a tool call directly. */
export function InterruptedTurnContinue() {
  const thread = useThreadRuntime()
  const running = useAuiState(state => state.thread.isRunning)
  const { t } = useI18n()
  return (
    <Button
      disabled={running}
      onClick={() =>
        thread.append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Continue the interrupted turn. Treat missing tool outcomes as UNKNOWN. Inspect current state before retrying any side-effecting operation; do not blindly repeat commands.'
            }
          ]
        })
      }
      size="sm"
      variant="outline"
    >
      {t.common.continue}
    </Button>
  )
}
