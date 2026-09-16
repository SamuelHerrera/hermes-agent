import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import {
  getApiRequestProfile,
  getSudoSettings,
  saveSudoFiles,
  saveSudoPassword,
  type SudoSettingsStatus,
  writeSudoHostPassword
} from '@/hermes'
import { useI18n } from '@/i18n'
import { $activeProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { SettingsContent, SettingsSkeleton } from './primitives'

export function SudoSettings() {
  const activeProfile = useStore($activeProfile)
  const connection = useStore($connection)
  // Remount clears drafts and invalidates pending results on every owner switch.
  const profile = getApiRequestProfile()

  return <SudoSettingsForm key={`${activeProfile}:${connection?.baseUrl}:${profile}`} profile={profile} />
}

function SudoSettingsForm({ profile }: { profile: null | string }) {
  const { t } = useI18n()
  const copy = t.sudoSettings
  const [status, setStatus] = useState<SudoSettingsStatus | null>(null)
  const [password, setPassword] = useState('')
  const [filePassword, setFilePassword] = useState('')
  const [fileHost, setFileHost] = useState('')
  const [confirm, setConfirm] = useState<'remove' | 'file' | null>(null)
  const [file, setFile] = useState('')
  const [rows, setRows] = useState<{ host: string; path: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const alive = useRef(true)
  // eslint-disable-next-line no-restricted-syntax -- lifecycle cancellation flag, not mirrored reactive state
  useEffect(() => {
    alive.current = true
    let cancelled = false
    void getSudoSettings(profile)
      .then(next => {
        if (cancelled) {
          return
        }

        if (!next?.owner || typeof next.password_set !== 'boolean' || !next.files) {
          throw new Error('unsupported')
        }

        setStatus(next)
        setFile(next.file)
        setRows(Object.entries(next.files).map(([host, path]) => ({ host, path })))
        setError('')
      })
      .catch(() => {
        if (!cancelled) {
          setError(copy.loadHelp)
        }
      })

    return () => {
      cancelled = true
      alive.current = false
    }
  }, [attempt, copy.loadHelp, profile])

  async function mutate(action: () => Promise<SudoSettingsStatus>) {
    setBusy(true)
    setError('')
    setSaved(false)

    try {
      const next = await action()

      if (!alive.current) {
        return
      }

      setStatus(next)
      setSaved(true)

      return next
    } catch {
      if (alive.current) {
        setError(copy.failed)
      }
    } finally {
      if (alive.current) {
        setBusy(false)
        setPassword('')
        setFilePassword('')
      }
    }
  }

  function saveFiles() {
    const hosts = rows.map(row => row.host.trim())

    if (
      rows.some(row => !row.host.trim() || !row.path.trim() || /\s/.test(row.host.trim())) ||
      new Set(hosts).size !== hosts.length
    ) {
      setError(copy.invalid)

      return
    }

    void mutate(() =>
      saveSudoFiles(file.trim(), Object.fromEntries(rows.map(row => [row.host.trim(), row.path.trim()])), profile)
    )
  }

  const availability = (value: string | undefined) =>
    copy[(value || 'unset') as 'available' | 'missing' | 'unreadable' | 'not_regular' | 'unset']

  if (!status) {
    return error ? (
      <SettingsContent>
        <ErrorState description={error} title={copy.loadFailed}>
          <Button
            onClick={() => {
              setError('')
              setAttempt(n => n + 1)
            }}
            variant="secondary"
          >
            {copy.retry}
          </Button>
        </ErrorState>
      </SettingsContent>
    ) : (
      <SettingsSkeleton sections={[{ rows: 4 }]} />
    )
  }

  const referencesDirty =
    file !== status.file ||
    JSON.stringify(Object.fromEntries(rows.map(row => [row.host, row.path]))) !== JSON.stringify(status.files)

  return (
    <SettingsContent>
      <div className="grid gap-8 py-4">
        <section className="grid gap-3">
          <h2 className="font-medium">{copy.title}</h2>
          <div className="text-sm text-muted-foreground">{copy.owner}</div>
          <div className="flex flex-wrap gap-2">
            <span>{status.owner.host}</span>
            <span>{profile || 'default'}</span>
            <code>{status.owner.home}</code>
          </div>
          <p className="text-sm text-muted-foreground">{copy.scope}</p>
          <p className="text-sm text-muted-foreground">{copy.precedence}</p>
        </section>
        <section className="grid gap-3">
          <div>{status.password_set ? copy.passwordSet : copy.passwordUnset}</div>
          <label className="grid gap-2">
            {copy.password}
            <Input
              autoComplete="new-password"
              disabled={busy}
              onChange={event => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <div className="flex gap-2">
            <Button disabled={busy || !password} onClick={() => void mutate(() => saveSudoPassword(password, profile))}>
              {copy.savePassword}
            </Button>
            <Button disabled={busy || !status.password_set} onClick={() => setConfirm('remove')} variant="destructive">
              {copy.removePassword}
            </Button>
          </div>
        </section>
        <section className="grid gap-3">
          <h3 className="font-medium">{copy.references}</h3>
          <p className="text-sm text-muted-foreground">{copy.referenceHelp}</p>
          <label className="grid gap-2">
            {copy.file}
            <Input disabled={busy} onChange={event => setFile(event.target.value)} value={file} />
          </label>
          {file === status.file && (
            <span className="text-sm text-muted-foreground">{availability(status.file_availability)}</span>
          )}
          {rows.map((row, i) => (
            <div className="grid gap-2" key={i}>
              <div className="flex gap-2">
                <Input
                  aria-label={`${copy.host} ${i + 1}`}
                  disabled={busy}
                  onChange={event =>
                    setRows(current => current.map((r, n) => (n === i ? { ...r, host: event.target.value } : r)))
                  }
                  placeholder={copy.host}
                  value={row.host}
                />
                <Input
                  aria-label={`${copy.path} ${i + 1}`}
                  disabled={busy}
                  onChange={event =>
                    setRows(current => current.map((r, n) => (n === i ? { ...r, path: event.target.value } : r)))
                  }
                  placeholder={copy.path}
                  value={row.path}
                />
                <Button
                  disabled={busy}
                  onClick={() => setRows(current => current.filter((_, n) => n !== i))}
                  variant="text"
                >
                  {copy.removeHost}
                </Button>
              </div>
              {status.files[row.host] === row.path && (
                <span className="text-sm text-muted-foreground">{availability(status.availability[row.host])}</span>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() => setRows(current => [...current, { host: '', path: '' }])}
              variant="secondary"
            >
              {copy.addHost}
            </Button>
            <Button disabled={busy} onClick={saveFiles}>
              {copy.saveFiles}
            </Button>
          </div>
        </section>
        <section className="grid gap-3">
          <h3 className="font-medium">{copy.writeFile}</h3>
          <p className="text-sm text-muted-foreground">{copy.fileWriteHelp}</p>
          <label className="grid gap-2">
            {copy.fileHost}
            <Input disabled={busy} onChange={event => setFileHost(event.target.value)} value={fileHost} />
          </label>
          <label className="grid gap-2">
            {copy.filePassword}
            <Input
              autoComplete="new-password"
              disabled={busy}
              onChange={event => setFilePassword(event.target.value)}
              type="password"
              value={filePassword}
            />
          </label>
          <div>
            <Button disabled={busy || referencesDirty || !fileHost || !filePassword} onClick={() => setConfirm('file')}>
              {copy.writeFile}
            </Button>
          </div>
        </section>
        <ConfirmDialog
          description={
            <>
              {confirm === 'file' ? copy.confirmFile : copy.confirmRemove}
              <br />
              <code>
                {status.owner.host} · {status.owner.home}
                {confirm === 'file' ? `/sudo-passwords/${fileHost}.password` : '/.env'}
              </code>
            </>
          }
          destructive
          dismissOnConfirm
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const next = await mutate(() =>
              confirm === 'file'
                ? writeSudoHostPassword(fileHost, filePassword, profile)
                : saveSudoPassword(null, profile)
            )

            if (!next) {
              throw new Error(copy.failed)
            }

            if (confirm === 'file' && alive.current) {
              setRows(Object.entries(next.files).map(([host, path]) => ({ host, path })))
            }
          }}
          open={confirm !== null}
          title={confirm === 'file' ? copy.writeFile : copy.removePassword}
        />
        {error && <ErrorState description={error} title={copy.failed} />}
        {saved && <p role="status">{copy.saved}</p>}
      </div>
    </SettingsContent>
  )
}
