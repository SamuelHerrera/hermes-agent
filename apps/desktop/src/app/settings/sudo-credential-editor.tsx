import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  getSudoSettings,
  saveSudoFiles,
  saveSudoPassword,
  type SudoSettingsStatus,
  writeSudoHostPassword
} from '@/hermes'
import { useI18n } from '@/i18n'

import { SudoFileField } from './sudo-file-field'

interface SudoCredentialEditorProps {
  status: SudoSettingsStatus
  target: string
  profile: null | string
  onSaved: (next: SudoSettingsStatus, target: string) => void
  onBusy: (busy: boolean) => void
}

// Empty target is a new host; local/default are reserved runtime fallback keys.
export function SudoCredentialEditor({ status, target, profile, onSaved, onBusy }: SudoCredentialEditorProps) {
  const { t } = useI18n()
  const copy = t.sudoSettings
  const local = target === 'local'
  const [host, setHost] = useState(target)
  const [method, setMethod] = useState<'file' | 'password'>(status.files[target] ? 'file' : 'password')
  const [path, setPath] = useState(status.files[target] || '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [confirm, setConfirm] = useState<'password' | 'reference' | 'legacy' | null>(null)
  const alive = useRef(true)
  // eslint-disable-next-line no-restricted-syntax -- cancellation flag, not mirrored reactive state
  useEffect(() => {
    alive.current = true

    return () => {
      alive.current = false
    }
  }, [])

  async function mutate(action: () => Promise<SudoSettingsStatus>, nextTarget = host.trim()) {
    if (busy) {
      return
    }

    setBusy(true)
    onBusy(true)
    setError('')
    setSaved(false)
    // Clear the renderer draft as soon as it has been handed to the request.
    setPassword('')
    setConfirm(null)

    try {
      const next = await action()

      if (alive.current) {
        setPath(next.files[nextTarget] || '')
        setSaved(true)
        onSaved(next, nextTarget)
      }
    } catch {
      if (alive.current) {
        setError(copy.failed)
      }
    } finally {
      if (alive.current) {
        setBusy(false)
        onBusy(false)
      }
    }
  }

  function validHost() {
    const value = host.trim()

    if (!value || /\s/.test(value) || (!target && (['local', 'default'].includes(value) || value in status.files))) {
      setError(copy.invalid)

      return false
    }

    return true
  }

  // Fetch fresh references before editing one target, preserving other hosts.
  async function reference(value: string | null) {
    const latest = await getSudoSettings(profile)

    if (!alive.current) {
      throw new Error('Owner changed')
    }

    const files = { ...latest.files }

    if (value === null) {
      delete files[host.trim()]
    } else {
      files[host.trim()] = value
    }

    return saveSudoFiles(latest.file, files, profile)
  }

  const availability = status.availability[target] || 'unset'
  const source = status.files[target]
  const legacy = local && !source && (status.files.default || (status.password_set ? '.env' : status.file))

  const legacyAvailability = status.files.default
    ? status.availability.default
    : status.password_set
      ? null
      : status.file_availability

  const referenceLabel = source?.startsWith(status.owner.home + '/')
    ? '$HERMES_HOME' + source.slice(status.owner.home.length)
    : source

  return (
    <section aria-label={copy.credential} className="min-w-0 flex-1 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{local ? status.owner.host : target || copy.addHost}</h3>
        <span className="text-xs text-muted-foreground">
          {source
            ? copy[availability as 'available' | 'missing' | 'unreadable' | 'not_regular' | 'unset']
            : legacy
              ? legacyAvailability
                ? copy[legacyAvailability as 'available' | 'missing' | 'unreadable' | 'not_regular' | 'unset']
                : copy.passwordSet
              : copy.unset}
        </span>
      </div>
      {!target && (
        <label className="grid gap-2 text-xs">
          {copy.host}
          <Input disabled={busy} onChange={e => setHost(e.target.value)} value={host} />
        </label>
      )}
      <SegmentedControl
        disabled={busy}
        onChange={value => {
          setMethod(value)
          setPassword('')
          setSaved(false)
        }}
        options={[
          { id: 'file', label: copy.selectFile },
          { id: 'password', label: copy.enterPassword }
        ]}
        value={method}
      />
      {method === 'file' ? (
        <SudoFileField
          disabled={busy}
          home={status.owner.home}
          onChange={value => {
            setPath(value)
            setSaved(false)
          }}
          profile={profile}
          value={path}
        />
      ) : (
        <label className="grid gap-2 text-xs">
          {copy.password}
          <Input
            aria-label={copy.password}
            autoComplete="new-password"
            disabled={busy}
            onChange={e => {
              setPassword(e.target.value)
              setSaved(false)
            }}
            type="password"
            value={password}
          />
          <span className="text-muted-foreground">{copy.privateFileHelp}</span>
        </label>
      )}
      {source && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <span>{copy.activeReference}</span>
          <code className="block truncate text-foreground" title={source}>
            {referenceLabel}
          </code>
        </div>
      )}
      {legacy && (
        <p className="break-all text-xs text-muted-foreground">
          {copy.legacySource} <code>{legacy}</code>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {local || target === 'default' ? copy.localUse : copy.hostUse} {copy.runtimeUse}
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {source && (
          <Button disabled={busy} onClick={() => setConfirm('reference')} variant="text">
            {copy.removeReference}
          </Button>
        )}
        <Button
          disabled={busy || (method === 'password' ? !password : !path.trim() || path === source)}
          onClick={() => {
            if (!validHost()) {
              return
            }

            if (method === 'password') {
              setConfirm('password')
            } else {
              void mutate(() => reference(path.trim()))
            }
          }}
        >
          {method === 'password' ? copy.savePassword : copy.saveReference}
        </Button>
      </div>
      {local && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{copy.legacySettings}</summary>
          <div className="mt-3 space-y-3">
            <p>{copy.legacyHelp}</p>
            {status.password_set && (
              <Button disabled={busy} onClick={() => setConfirm('legacy')} size="sm" variant="text">
                {copy.removePassword}
              </Button>
            )}
            <LegacyFile busy={busy} mutate={mutate} profile={profile} status={status} />
          </div>
        </details>
      )}
      {error && <ErrorState description={error} title={copy.failed} />}
      {saved && (
        <p className="text-xs text-muted-foreground" role="status">
          {copy.saved}
        </p>
      )}
      <ConfirmDialog
        description={
          <>
            {confirm === 'password'
              ? copy.confirmFile
              : confirm === 'legacy'
                ? copy.confirmRemove
                : copy.confirmReference}
            <code className="mt-2 block break-all">
              {status.owner.host} · {host}
            </code>
          </>
        }
        destructive={confirm !== 'password'}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          mutate(() =>
            confirm === 'password'
              ? writeSudoHostPassword(host.trim(), password, profile)
              : confirm === 'legacy'
                ? saveSudoPassword(null, profile)
                : reference(null)
          )
        }
        open={confirm !== null}
        title={
          confirm === 'password' ? copy.savePassword : confirm === 'legacy' ? copy.removePassword : copy.removeReference
        }
      />
    </section>
  )
}

function LegacyFile({
  status,
  profile,
  busy,
  mutate
}: {
  status: SudoSettingsStatus
  profile: null | string
  busy: boolean
  mutate: (action: () => Promise<SudoSettingsStatus>, target?: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [path, setPath] = useState(status.file)

  return (
    <div className="space-y-2">
      <label className="grid gap-2">
        {t.sudoSettings.file}
        <Input disabled={busy} onChange={e => setPath(e.target.value)} value={path} />
      </label>
      <Button
        disabled={busy || path === status.file}
        onClick={() =>
          void mutate(async () => {
            const latest = await getSudoSettings(profile)

            return saveSudoFiles(path.trim(), latest.files, profile)
          }, 'local')
        }
        size="sm"
        variant="secondary"
      >
        {t.sudoSettings.saveReference}
      </Button>
    </div>
  )
}
