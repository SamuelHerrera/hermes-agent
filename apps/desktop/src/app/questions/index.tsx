import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { getApiRequestProfile, type HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import { $gateway } from '@/store/gateway'
import { $activeProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { PAGE_INSET_X } from '../layout-constants'
import { openSession } from '../open-session'
import { PageSearchShell } from '../page-search-shell'

import { questionCopy } from './copy'
import { type Question, QuestionRow } from './question-row'

interface QuestionSettings {
  clarify_timeout: number
  clarify_soft_timeout: number
  clarify_review_timeout: number
}
interface InboxResponse {
  questions: Question[]
  settings: QuestionSettings
}

export function QuestionsView() {
  const gateway = useStore($gateway)
  const activeProfile = useStore($activeProfile)
  const connection = useStore($connection)
  const profile = getApiRequestProfile()
  const { locale } = useI18n()

  if (!gateway) {
    return <EmptyState title={questionCopy[locale].disconnected} />
  }

  return (
    <QuestionsInbox gateway={gateway} key={`${activeProfile}:${connection?.baseUrl}:${profile}`} profile={profile} />
  )
}

function QuestionsInbox({ gateway, profile }: { gateway: HermesGateway; profile: string | null }) {
  const { locale } = useI18n()
  const copy = questionCopy[locale]
  const navigate = useNavigate()
  const [data, setData] = useState<InboxResponse | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [all, setAll] = useState(false)
  const [offset, setOffset] = useState(0)
  const { current: generation } = useRef({ value: 0 })

  const refresh = useCallback(async () => {
    const token = ++generation.value

    try {
      const next = await gateway.request<InboxResponse>('questions.list', {
        profile,
        include_answered: all,
        limit: 50,
        offset,
        query: search
      })

      if (token === generation.value) {
        setData(next)
        setError('')
      }
    } catch (err) {
      if (token === generation.value) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }, [gateway, profile, all, offset, search, generation])

  useEffect(() => {
    void refresh()

    const offEvent = gateway.onEvent(event => {
      if (event.type === 'questions.changed' || event.type === 'clarify.request') {
        void refresh()
      }
    })

    const offState = gateway.onState(state => {
      if (state === 'open') {
        void refresh()
      }
    })

    return () => {
      generation.value++
      offEvent()
      offState()
    }
  }, [gateway, refresh, generation])

  async function answer(row: Question, value: string | string[]) {
    const result = await gateway.request<{ delivery_error?: string }>('questions.respond', {
      profile,
      question_id: row.id,
      answer: value
    })

    if (result.delivery_error) {
      await refresh()
      setError(`${copy.savedOnly} ${result.delivery_error}`)

      return
    }

    await refresh()
  }

  const rows = data?.questions ?? []

  return (
    <PageSearchShell
      activeTab={all ? 'all' : 'open'}
      onSearchChange={value => {
        setSearch(value)
        setOffset(0)
      }}
      onTabChange={tab => {
        setData(null)
        setOffset(0)
        setAll(tab === 'all')
      }}
      searchPlaceholder={copy.search}
      searchTrailingAction={
        <Button onClick={() => void refresh()} size="sm" variant="text">
          {copy.refresh}
        </Button>
      }
      searchValue={search}
      tabs={[
        { id: 'open', label: copy.open },
        { id: 'all', label: copy.all }
      ]}
    >
      <div className={`min-h-0 flex-1 overflow-auto ${PAGE_INSET_X} pb-6`}>
        <h1 className="text-lg font-medium">{copy.title}</h1>
        <p className="mb-3 text-xs text-(--ui-text-tertiary)">
          {copy.scope}: {profile || 'default'}
        </p>
        {error && <ErrorState description={error} title={copy.failed} />}
        {!data && !error && <PageLoader />}
        {data && (
          <>
            <QuestionSettingsForm gateway={gateway} profile={profile} settings={data.settings} />
            {rows.length === 0 && <EmptyState title={copy.empty} />}
            {rows.map(row => (
              <QuestionRow
                copy={copy}
                key={row.id}
                onAnswer={value => answer(row, value)}
                onOpen={() => openSession(row.session_id, navigate, 'tab')}
                row={row}
              />
            ))}
            {offset > 0 && (
              <Button onClick={() => setOffset(value => Math.max(0, value - 50))} size="sm" variant="text">
                {copy.previous}
              </Button>
            )}
            {data.questions.length === 50 && (
              <Button onClick={() => setOffset(value => value + 50)} size="sm" variant="text">
                {copy.more}
              </Button>
            )}
          </>
        )}
      </div>
    </PageSearchShell>
  )
}

function QuestionSettingsForm({
  settings,
  gateway,
  profile
}: {
  settings: QuestionSettings
  gateway: HermesGateway
  profile: string | null
}) {
  const { locale } = useI18n()
  const copy = questionCopy[locale]
  const [draft, setDraft] = useState(settings)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const fields = [
    ['clarify_timeout', copy.expiry],
    ['clarify_soft_timeout', copy.softTimeout],
    ['clarify_review_timeout', copy.budget]
  ] as const

  async function save() {
    setBusy(true)
    setError('')

    try {
      for (const [key] of fields) {
        await gateway.request('questions.settings', { profile, key, value: draft[key] })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="py-3">
      <summary className="cursor-pointer text-sm">{copy.settings}</summary>
      <p className="my-3 max-w-prose text-xs text-(--ui-text-secondary)">{copy.help}</p>
      <form
        className="grid max-w-lg gap-3"
        onSubmit={event => {
          event.preventDefault()
          void save()
        }}
      >
        {fields.map(([key, label]) => (
          <label className="grid gap-1 text-xs" key={key}>
            {label}
            <Input
              min={key === 'clarify_review_timeout' ? 1 : 0}
              onChange={event => setDraft(previous => ({ ...previous, [key]: Number(event.target.value) }))}
              required
              step={1}
              type="number"
              value={draft[key]}
            />
          </label>
        ))}
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <div>
          <Button disabled={busy} size="sm" type="submit">
            {copy.save}
          </Button>
        </div>
      </form>
    </details>
  )
}
