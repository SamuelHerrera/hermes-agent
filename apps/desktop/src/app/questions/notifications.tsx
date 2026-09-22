import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getApiRequestProfile, type HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import { $gateway } from '@/store/gateway'
import { $activeProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { openSession } from '../open-session'
import { SETTINGS_ROUTE } from '../routes'
import { openSettingsTab } from '../settings/tab-route'
import { titlebarButtonClass } from '../shell/titlebar'
import { TitlebarIcon } from '../shell/titlebar-icon'

import { questionCopy } from './copy'
import { type Question, QuestionRow } from './question-row'
import { useOpenQuestions } from './use-open-questions'

interface QuestionNotificationsProps {
  gateway: HermesGateway | null
  profile: string | null
  copy: typeof questionCopy.en
  onOpenSession: (sessionId: string) => void
  onSettings: () => void
}

export function QuestionNotifications({
  gateway,
  profile,
  copy,
  onOpenSession,
  onSettings
}: QuestionNotificationsProps) {
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const skipRestoreFocus = useRef(false)
  const inbox = useOpenQuestions(gateway, profile, offset)
  useEffect(() => {
    setOpen(false)
    setOffset(0)
  }, [gateway, profile])
  useEffect(() => {
    if (offset > 0 && offset >= inbox.count) {
      setOffset(0)
    }
  }, [inbox.count, offset])

  async function answer(row: Question, value: string | string[]) {
    if (!gateway) {
      throw new Error(copy.disconnected)
    }

    const result = await gateway.request<{ delivery_error?: string }>('questions.respond', {
      profile,
      question_id: row.id,
      answer: value
    })

    await inbox.refresh()

    if (result.delivery_error) {
      throw new Error(`${copy.savedOnly} ${result.delivery_error}`)
    }
  }

  async function dismiss(row: Question) {
    if (!gateway) {
      throw new Error(copy.disconnected)
    }

    await gateway.request('questions.dismiss', { profile, question_id: row.id })
    await inbox.refresh()
  }

  function focusChat(sessionId: string) {
    skipRestoreFocus.current = true
    setOpen(false)
    onOpenSession(sessionId)
  }

  return (
    <Popover
      onOpenChange={next => {
        skipRestoreFocus.current = false
        setOpen(next)

        if (next) {
          void inbox.refresh()
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={`${copy.notifications}${inbox.count ? ` (${inbox.count})` : ''}`}
          className={`relative ${titlebarButtonClass}`}
          size="icon-titlebar"
          title={copy.notifications}
          variant="ghost"
        >
          <TitlebarIcon name="bell" />
          {inbox.count > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 min-w-3 rounded-full bg-primary px-0.5 text-center text-[9px] leading-3 text-primary-foreground"
            >
              {inbox.count > 99 ? '99+' : inbox.count}
            </span>
          )}
          {inbox.error && <span aria-hidden className="absolute right-0 top-0 size-1 rounded-full bg-destructive" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={copy.notifications}
        className="z-80 flex w-[min(25rem,calc(100vw-24px))] max-h-[min(36rem,var(--radix-popover-content-available-height))] flex-col p-0 [-webkit-app-region:no-drag]"
        onCloseAutoFocus={event => {
          if (skipRestoreFocus.current) {
            event.preventDefault()
          }
        }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-3 py-2">
          <h2 className="flex-1 text-sm font-medium">{copy.notifications}</h2>
          <Button aria-label={copy.refresh} onClick={() => void inbox.refresh()} size="icon-xs" variant="ghost">
            <TitlebarIcon name="refresh" />
          </Button>
          <Button
            aria-label={copy.settings}
            onClick={() => {
              skipRestoreFocus.current = true
              setOpen(false)
              onSettings()
            }}
            size="icon-xs"
            variant="ghost"
          >
            <TitlebarIcon name="settings-gear" />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-2">
          <p className="pt-2 text-xs text-(--ui-text-tertiary)">
            {copy.title} · {profile || 'default'}
            {inbox.count > 0 ? ` · ${inbox.count}` : ''}
          </p>
          {!gateway && <p className="py-4 text-xs text-muted-foreground">{copy.disconnected}</p>}
          {inbox.error && (
            <p className="py-3 text-xs text-destructive" role="alert">
              {copy.failed}: {inbox.error}
            </p>
          )}
          {inbox.loading && (
            <p className="py-4 text-xs text-muted-foreground" role="status">
              {copy.loading}
            </p>
          )}
          {gateway && !inbox.loading && !inbox.error && inbox.questions.length === 0 && (
            <p className="py-5 text-center text-xs text-muted-foreground">{copy.empty}</p>
          )}
          {inbox.questions.map(row => (
            <QuestionRow
              compact
              copy={copy}
              key={`${profile}:${row.id}`}
              onAnswer={value => answer(row, value)}
              onDismiss={() => dismiss(row)}
              onOpen={() => focusChat(row.session_id)}
              row={row}
            />
          ))}
          <div className="flex justify-between">
            {offset > 0 && (
              <Button onClick={() => setOffset(value => Math.max(0, value - 50))} size="xs" variant="text">
                {copy.previous}
              </Button>
            )}
            {offset + inbox.questions.length < inbox.count && (
              <Button onClick={() => setOffset(value => value + 50)} size="xs" variant="text">
                {copy.more}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function QuestionNotificationsControl() {
  const gateway = useStore($gateway)
  const activeProfile = useStore($activeProfile)
  const connection = useStore($connection)
  const profile = getApiRequestProfile()
  const navigate = useNavigate()
  const { locale } = useI18n()

  return (
    <QuestionNotifications
      copy={questionCopy[locale]}
      gateway={gateway}
      key={`${activeProfile}:${connection?.baseUrl}:${profile}`}
      onOpenSession={sid => openSession(sid, navigate, 'stack')}
      onSettings={() => openSettingsTab(`${SETTINGS_ROUTE}?tab=config:advanced`)}
      profile={profile}
    />
  )
}
