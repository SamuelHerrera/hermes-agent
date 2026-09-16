import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ErrorState } from '@/components/ui/error-state'
import { getApiRequestProfile, getSudoSettings, type SudoSettingsStatus } from '@/hermes'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $activeProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { SettingsContent, SettingsSkeleton } from './primitives'
import { SudoCredentialEditor } from './sudo-credential-editor'

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
  const [selected, setSelected] = useState('local')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
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

        setError('')
      })
      .catch(() => {
        if (!cancelled) {
          setError(copy.loadHelp)
        }
      })

    return () => {
      cancelled = true
    }
  }, [attempt, copy.loadHelp, profile])

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

  function targetButton(target: string, label: string, icon: 'server' | 'device-desktop') {
    return (
      <button
        aria-label={label}
        aria-pressed={selected === target}
        className={cn(
          'row-hover flex w-full min-w-0 items-center gap-2 rounded px-2 py-2 text-left text-xs disabled:opacity-50',
          selected === target && 'bg-(--ui-bg-tertiary) text-foreground'
        )}
        disabled={busy}
        key={target}
        onClick={() => setSelected(target)}
        type="button"
      >
        <Codicon name={icon} />
        <span className="truncate">{label}</span>
      </button>
    )
  }

  return (
    <SettingsContent>
      <div className="max-w-4xl space-y-5 py-4">
        <header className="space-y-2">
          <h2 className="font-medium">{copy.title}</h2>
          <p className="text-xs text-muted-foreground">
            {copy.owner}:{' '}
            <span className="text-foreground">
              {status.owner.host} · {profile || 'default'}
            </span>
          </p>
        </header>
        <div className="@container">
          <div className="flex flex-col gap-6 @xl:flex-row">
            <nav aria-label={copy.targets} className="shrink-0 space-y-4 @xl:w-44">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{copy.thisBackend}</p>
                {targetButton('local', copy.thisBackend, 'device-desktop')}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{copy.sshHosts}</p>
                {Object.keys(status.files)
                  .filter(host => !['local', 'default'].includes(host))
                  .map(host => targetButton(host, host, 'server'))}
                <Button disabled={busy} onClick={() => setSelected('')} size="sm" variant="text">
                  <Codicon name="add" />
                  {copy.addHost}
                </Button>
              </div>
              {status.files.default && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{copy.legacySettings}</p>
                  {targetButton('default', copy.defaultSource, 'device-desktop')}
                </div>
              )}
            </nav>
            <SudoCredentialEditor
              key={selected}
              onBusy={setBusy}
              onSaved={(next, target) => {
                setStatus(next)
                setSelected(target)
              }}
              profile={profile}
              status={status}
              target={selected}
            />
          </div>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{copy.howItWorks}</summary>
          <div className="mt-3 space-y-2">
            <p>{copy.scope}</p>
            <p>{copy.precedence}</p>
            <p>{copy.referenceHelp}</p>
            <code className="break-all">{status.owner.home}</code>
          </div>
        </details>
      </div>
    </SettingsContent>
  )
}
