import { useCallback, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/search-field'
import { useI18n } from '@/i18n'
import { ChevronRight } from '@/lib/icons'
import type { EnvVarInfo } from '@/types/hermes'

import { credentialPlaceholder, KeyField, type KeyRowProps } from './credential-key-ui'
import { groupToolCredentials, matchesToolQuery } from './tool-credential-groups'
import { useDeepLinkHighlight } from './use-deep-link-highlight'

interface ToolCredentialCardsProps {
  rowProps: KeyRowProps
  vars: Record<string, EnvVarInfo>
}

const credentialElementId = (key: string) => `credential-key-${key}`

export function ToolCredentialCards({ rowProps, vars }: ToolCredentialCardsProps) {
  const { t } = useI18n()
  const copy = t.settings.toolCredentials
  const [revealKey, setRevealKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const triggers = useRef(new Map<string, HTMLButtonElement>())
  const groups = groupToolCredentials(vars, copy)
  const active = groups.find(group => group.entries.some(([key]) => key === openKey))
  const visible = groups.filter(group => matchesToolQuery(group, query))

  const resolveDeepLink = useCallback((key: string) => {
    setQuery('')
    setOpenKey(key)
  }, [])

  const readyForDeepLink = useCallback(
    (key: string) => vars[key]?.category === 'tool' && !vars[key]?.channel_managed,
    [vars]
  )

  useDeepLinkHighlight({
    elementId: credentialElementId,
    onResolve: resolveDeepLink,
    param: 'key',
    ready: readyForDeepLink
  })

  return (
    <>
      {groups.length > 0 && <SearchField onChange={setQuery} placeholder={copy.search} value={query} />}
      <p className="text-xs text-muted-foreground">{copy.notVerified}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3">
        {visible.map(group => (
          <Button
            aria-haspopup="dialog"
            aria-label={group.name}
            className="grid items-start justify-stretch gap-2 whitespace-normal text-left"
            key={group.id}
            onClick={() => {
              setOpenKey(group.entries[0][0])
            }}
            ref={element => {
              if (element) {
                triggers.current.set(group.id, element)
              } else {
                triggers.current.delete(group.id)
              }
            }}
            size="lg"
            variant="secondary"
          >
            <span className="flex items-center gap-2">
              <group.icon aria-hidden="true" />
              <span>{group.name}</span>
              <ChevronRight aria-hidden="true" className="ml-auto shrink-0 text-muted-foreground" />
            </span>
            <span className="text-xs font-normal text-muted-foreground">{group.description}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {copy.savedFields(group.entries.filter(([, info]) => info.is_set).length, group.entries.length)}
            </span>
          </Button>
        ))}
      </div>
      {visible.length === 0 && <EmptyState title={groups.length ? copy.noResults : t.settings.keys.empty} />}
      <Dialog
        onOpenChange={open => {
          if (!open) {
            setOpenKey(null)
            setRevealKey(null)
          }
        }}
        open={Boolean(active)}
      >
        {active && (
          <DialogContent
            onCloseAutoFocus={event => {
              event.preventDefault()
              triggers.current.get(active.id)?.focus()
            }}
            onEscapeKeyDown={event => {
              // Radix handles Escape at document capture, before KeyField cancels its
              // draft. Let that input consume this press; a second Escape closes.
              const focusedKey = (document.activeElement as HTMLElement | null)?.getAttribute('aria-label')

              if (focusedKey && rowProps.edits[focusedKey] !== undefined) {
                event.preventDefault()
              }
            }}
            onOpenAutoFocus={event => {
              event.preventDefault()
              document.getElementById(`credential-input-${openKey}`)?.focus()
            }}
          >
            <DialogHeader>
              <DialogTitle icon={active.icon}>{active.name}</DialogTitle>
              <DialogDescription>{active.description}</DialogDescription>
            </DialogHeader>
            {active.entries.map(([key, info]) => (
              <div className="grid gap-2 scroll-mt-4" id={`credential-key-${key}`} key={key}>
                <label className="break-all font-mono text-xs" htmlFor={`credential-input-${key}`}>
                  {key}
                </label>
                <p className="text-xs text-muted-foreground">{info.description}</p>
                <KeyField
                  expanded
                  id={`credential-input-${key}`}
                  info={info}
                  placeholder={credentialPlaceholder(key, info, active.name)}
                  rowProps={rowProps}
                  varKey={key}
                />
                {info.is_set && (
                  <div className="grid gap-1">
                    <Button
                      className="justify-self-start"
                      onClick={() => {
                        setRevealKey(revealKey === key ? null : key)

                        if (revealKey !== key && !rowProps.revealed[key]) {
                          void rowProps.onReveal(key)
                        }
                      }}
                      size="inline"
                      variant="text"
                    >
                      {revealKey === key ? t.settings.envActions.hideValue : t.settings.envActions.revealValue}
                    </Button>
                    {revealKey === key && rowProps.revealed[key] && (
                      <output className="break-all font-mono text-xs">{rowProps.revealed[key]}</output>
                    )}
                  </div>
                )}
                {info.url && (
                  <a
                    className="text-xs text-muted-foreground underline underline-offset-4"
                    href={info.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t.settings.envActions.docs}
                  </a>
                )}
              </div>
            ))}
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
