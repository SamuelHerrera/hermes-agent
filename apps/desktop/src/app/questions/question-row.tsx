import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export interface Question {
  id: string
  session_id: string
  question: string
  choices: string[] | null
  multi_select: boolean
  requires_user: boolean
  status: string
  delivery_pending?: boolean
  answer: string | string[] | null
  answered_by: string | null
  review: { reason?: string; evidence?: Record<string, string> } | null
}

export interface QuestionRowCopy {
  answer: string
  resume: string
  other: string
  hard: string
  soft: string
  session: string
  automatic: string
  user: string
}

interface QuestionRowProps {
  row: Question
  copy: QuestionRowCopy
  onAnswer: (answer: string | string[]) => Promise<void>
  onOpen: () => void
}

export function QuestionRow({ row, copy, onAnswer, onOpen }: QuestionRowProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const answered = row.status === 'answered'
  const answer = row.delivery_pending ? (row.answer ?? '') : text.trim() || (row.multi_select ? selected : selected[0])
  const hasAnswer = Array.isArray(answer) ? answer.length > 0 : Boolean(answer)

  async function submit() {
    if (!hasAnswer || busy) {
      return
    }

    setBusy(true)
    setError('')

    try {
      await onAnswer(answer)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="grid gap-3 border-b border-(--ui-stroke-tertiary) py-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-(--ui-text-tertiary)">
        <span>{row.requires_user ? copy.hard : copy.soft}</span>
        <Button onClick={onOpen} size="xs" variant="text">
          {copy.session}
        </Button>
      </div>
      <h2 className="whitespace-pre-wrap break-words text-sm font-medium">{row.question}</h2>
      {row.review?.reason && <p className="text-xs text-(--ui-text-secondary)">{row.review.reason}</p>}
      {answered ? (
        <>
          <p className="whitespace-pre-wrap text-sm">
            {row.answered_by === 'reviewer' ? copy.automatic : copy.user}:{' '}
            {Array.isArray(row.answer) ? row.answer.join(', ') : row.answer}
          </p>
          {row.delivery_pending && (
            <div>
              <Button disabled={busy} onClick={() => void submit()} size="sm">
                {copy.resume}
              </Button>
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={event => {
            event.preventDefault()
            void submit()
          }}
        >
          <fieldset aria-label={row.question} className="grid gap-2" disabled={busy}>
            {(row.choices ?? []).map(choice => (
              <label className="flex items-start gap-2 whitespace-pre-wrap break-words text-sm" key={choice}>
                <input
                  checked={!text && selected.includes(choice)}
                  name={row.id}
                  onChange={event => {
                    setText('')
                    setSelected(previous =>
                      row.multi_select
                        ? event.target.checked
                          ? [...previous, choice]
                          : previous.filter(value => value !== choice)
                        : [choice]
                    )
                  }}
                  type={row.multi_select ? 'checkbox' : 'radio'}
                />
                <span>{choice}</span>
              </label>
            ))}
            <Textarea
              aria-label={copy.other}
              onChange={event => {
                setText(event.target.value)
                setSelected([])
              }}
              placeholder={copy.other}
              value={text}
            />
          </fieldset>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div>
            <Button disabled={busy || !hasAnswer} size="sm" type="submit">
              {copy.answer}
            </Button>
          </div>
        </form>
      )}
    </article>
  )
}
