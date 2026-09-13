import { useStore } from '@nanostores/react'
import { type FormEvent, useCallback, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import { Loader2, MessageQuestion } from '@/lib/icons'
import { clearClarifyRequest, sessionClarifyRequest } from '@/store/clarify'
import { notifyError } from '@/store/notifications'

interface PendingClarifyBannerProps {
  gateway: HermesGateway | null
  sessionId: string | null
}

/**
 * Composer-adjacent fallback for blocking clarify prompts.
 *
 * The transcript still owns the full inline card, but a user can be scrolled
 * away from it — or a reconnect can leave only the sidebar question badge in
 * view. While the backend is blocked on `clarify.respond`, keep the actual
 * question and a minimal answer path fused to the composer so the question mark
 * never becomes an unactionable mystery.
 */
export function PendingClarifyBanner({ gateway, sessionId }: PendingClarifyBannerProps) {
  const { t } = useI18n()
  const copy = t.assistant.clarify
  const $request = useMemo(() => sessionClarifyRequest(sessionId), [sessionId])
  const request = useStore($request)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const respond = useCallback(
    async (answer: string) => {
      if (!request) {
        return
      }

      if (!gateway) {
        notifyError(new Error(copy.gatewayDisconnected), copy.sendFailed)

        return
      }

      setSubmitting(true)

      try {
        await gateway.request('clarify.respond', { request_id: request.requestId, answer })
        clearClarifyRequest(request.requestId, request.sessionId)
        setDraft('')
      } catch (error) {
        notifyError(error, copy.sendFailed)
        setSubmitting(false)
      }
    },
    [copy.gatewayDisconnected, copy.sendFailed, gateway, request]
  )

  if (!request) {
    return null
  }

  const choices = request.choices ?? []
  const answer = draft.trim()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (answer) {
      void respond(answer)
    }
  }

  return (
    <form
      aria-label={request.question}
      className="mx-2 mb-1.5 grid gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 shadow-lg shadow-black/10 backdrop-blur"
      data-slot="pending-clarify-banner"
      onSubmit={submit}
    >
      <div className="flex items-start gap-2 text-[0.78rem] leading-snug text-foreground/92">
        <MessageQuestion aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere font-medium">{request.question}</span>
      </div>
      {choices.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" role="group">
          {choices.map(choice => (
            <Button
              className="h-6 max-w-full rounded-lg px-2 text-[0.7rem]"
              disabled={submitting}
              key={choice}
              onClick={() => void respond(choice)}
              type="button"
              variant="secondary"
            >
              <span className="truncate">{choice}</span>
            </Button>
          ))}
        </div>
      ) : (
        <Textarea
          className="min-h-0 resize-none text-[0.74rem]"
          disabled={submitting}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()

              if (answer) {
                void respond(answer)
              }
            }
          }}
          placeholder={copy.placeholder}
          rows={1}
          size="sm"
          value={draft}
        />
      )}
      <div className="flex items-center justify-end gap-1">
        <Button disabled={submitting} onClick={() => void respond('')} size="xs" type="button" variant="text">
          {copy.skip}
        </Button>
        {choices.length === 0 && (
          <Button disabled={submitting || !answer} size="xs" type="submit">
            {submitting ? <Loader2 className="size-3 animate-spin" /> : copy.continueLabel}
          </Button>
        )}
      </div>
    </form>
  )
}
