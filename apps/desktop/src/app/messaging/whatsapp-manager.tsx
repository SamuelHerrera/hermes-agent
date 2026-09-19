import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ErrorBanner } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { getApiRequestProfile } from '@/hermes'
import { openExternalLink } from '@/lib/external-link'
import { hostApi } from '@/platform/host-api'
import { runGatewayRestart } from '@/store/system-actions'

import { WhatsAppPairing } from './whatsapp-pairing'

interface Settings {
  enabled: boolean
  mode: string
  dm_policy: string
  allowed_users: string
  send_read_receipts?: boolean
  reply_prefix?: string
  group_policy?: string
  group_allow_from?: string
  require_mention?: boolean
  free_response_chats?: string
  mention_patterns?: string[]
}
type Status = {
  settings: Settings
  paired: boolean
  account_name?: string | null
  account_phone?: string | null
  bridge: { state: string; pid?: number; port?: number; queue_length?: number; send_read_receipts?: boolean }
}

/** Explicit actions only: mounting and refreshing never write or pair. */
export function WhatsAppManager({ onUnavailable }: { onUnavailable?: (unavailable: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [edits, setEdits] = useState<Partial<Settings>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [restart, setRestart] = useState(false)
  const generation = useRef(0)
  const profile = getApiRequestProfile()
  useEffect(() => {
    onUnavailable?.(/404|not found/i.test(error))
  }, [error, onUnavailable])

  const request = useCallback(
    <T,>(method: 'GET' | 'PUT', body?: Partial<Settings>) =>
      hostApi<T>({
        path: '/api/messaging/whatsapp/manage',
        method,
        body,
        ...(profile ? { profile } : {})
      }),
    [profile]
  )

  const refresh = useCallback(async () => {
    const current = ++generation.current
    setBusy(true)

    try {
      const result = await request<Status>('GET')

      if (current === generation.current) {
        setStatus(result)
        setError('')
      }
    } catch (err) {
      if (current === generation.current) {
        setError(
          `Could not read WhatsApp management: ${String(err)}. Update the backend if this endpoint is unavailable.`
        )
      }
    } finally {
      if (current === generation.current) {
        setBusy(false)
      }
    }
  }, [request])

  useEffect(() => {
    setStatus(null)
    setEdits({})
    setSaved(false)
    void refresh()

    return () => {
      // Invalidate all outstanding requests, not a DOM-ref cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
    }
  }, [refresh])

  const save = async () => {
    setBusy(true)
    setError('')
    const current = generation.current

    try {
      await request('PUT', edits)

      if (current !== generation.current || profile !== getApiRequestProfile()) {
        return
      }

      setEdits({})
      setSaved(true)
      await refresh()
    } catch (err) {
      if (current === generation.current) {
        setError(String(err))
      }
    } finally {
      if (profile === getApiRequestProfile()) {
        setBusy(false)
      }
    }
  }

  const field = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setEdits(old => {
      const next = { ...old, [key]: value }

      if (status?.settings[key] === value) {
        delete next[key]
      }

      return next
    })
  }

  const values = status ? { ...status.settings, ...edits } : null
  const control = 'h-8 rounded-md border border-input bg-background px-2 text-sm'

  return (
    <section aria-label="WhatsApp management" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold">WhatsApp bridge</h4>
        <Button disabled={busy} onClick={() => void refresh()} size="sm" variant="secondary">
          Refresh bridge status
        </Button>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {status && values && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt>Live bridge</dt>
            <dd>{status.bridge.state}</dd>
            <dt>Linked device</dt>
            <dd>{status.paired ? 'Paired session saved' : 'Not paired'}</dd>
            {status.account_name && (
              <>
                <dt>Account</dt>
                <dd>{status.account_name}</dd>
              </>
            )}
            {status.account_phone && (
              <>
                <dt>Phone</dt>
                <dd>{status.account_phone}</dd>
              </>
            )}
            {status.bridge.port && (
              <>
                <dt>Local bridge port</dt>
                <dd>{status.bridge.port}</dd>
              </>
            )}
            {status.bridge.pid && (
              <>
                <dt>Bridge process</dt>
                <dd>{status.bridge.pid}</dd>
              </>
            )}
            {status.bridge.queue_length !== undefined && (
              <>
                <dt>Queued messages</dt>
                <dd>{status.bridge.queue_length}</dd>
              </>
            )}
            {status.bridge.send_read_receipts !== undefined && (
              <>
                <dt>Read receipts (running)</dt>
                <dd>{status.bridge.send_read_receipts ? 'On' : 'Off'}</dd>
              </>
            )}
          </dl>
          <p className="text-xs text-muted-foreground">
            A saved paired session is not proof of a live connection. Refresh checks the bridge without sending a
            message or changing the session.
          </p>
          <h4 className="font-semibold">Saved configuration</h4>
          <p className="text-xs text-muted-foreground">
            Saving does not change the running gateway. Restart it to apply edits; live status above shows only what the
            bridge reports.
          </p>
          <label className="flex items-center gap-3">
            WhatsApp enabled
            <Switch
              aria-label="WhatsApp enabled"
              checked={values.enabled}
              disabled={busy}
              onCheckedChange={v => field('enabled', v)}
            />
          </label>
          <label className="grid gap-1">
            Bridge mode
            <select
              aria-label="Bridge mode"
              className={control}
              disabled={busy}
              onChange={e => field('mode', e.target.value)}
              value={values.mode}
            >
              <option value="bot">Bot — dedicated number</option>
              <option value="self-chat">Self-chat — message yourself</option>
            </select>
          </label>
          <label className="grid gap-1">
            WhatsApp DM policy
            <select
              aria-label="WhatsApp DM policy"
              className={control}
              disabled={busy}
              onChange={e => field('dm_policy', e.target.value)}
              value={values.dm_policy}
            >
              <option value="pairing">Pairing — require approval</option>
              <option value="allowlist">Allowlist only</option>
              <option value="disabled">Disabled — no DMs</option>
              <option value="open">Open — anyone can message</option>
            </select>
          </label>
          {values.dm_policy === 'open' && (
            <p className="text-sm text-amber-600">
              Open permits anyone to invoke the agent. Use an allowlist or pairing for a private assistant.
            </p>
          )}
          <label className="grid gap-1">
            Allowed WhatsApp users
            <Input
              aria-label="Allowed WhatsApp users"
              disabled={busy}
              onChange={e => field('allowed_users', e.target.value)}
              value={values.allowed_users}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Comma-separated phone numbers or WhatsApp IDs. Existing aliases are preserved. An empty allowlist grants
            nobody under the allowlist policy.
          </p>
          {values.send_read_receipts !== undefined && (
            <fieldset className="grid gap-3 rounded-md border p-3" disabled={busy}>
              <legend className="px-1 font-semibold">Message behavior</legend>
              <label className="flex items-center justify-between gap-3">
                Send read receipts
                <Switch
                  aria-label="Send read receipts"
                  checked={values.send_read_receipts}
                  onCheckedChange={v => field('send_read_receipts', v)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Mark accepted messages as read (blue ticks), before the reply finishes. Rejected messages are not marked
                read. Off preserves privacy.
              </p>
              <label className="grid gap-1">
                Reply header
                <textarea
                  aria-label="Reply header"
                  className="min-h-20 rounded-md border border-input bg-background p-2 text-sm"
                  onChange={e => field('reply_prefix', e.target.value)}
                  value={values.reply_prefix ?? ''}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Used in self-chat mode; bot mode sends without a header. Leave empty to remove it. Line breaks are
                preserved.
              </p>
            </fieldset>
          )}
          {values.group_policy !== undefined && (
            <fieldset className="grid gap-3 rounded-md border p-3" disabled={busy}>
              <legend className="px-1 font-semibold">Group conversations</legend>
              <label className="grid gap-1">
                Group policy
                <select
                  aria-label="Group policy"
                  className={control}
                  onChange={e => field('group_policy', e.target.value)}
                  value={values.group_policy}
                >
                  <option value="pairing">Pairing — legacy setting, groups blocked</option>
                  <option value="allowlist">Allowlist only</option>
                  <option value="disabled">Disabled — no groups</option>
                  <option value="open">Open — all groups</option>
                </select>
              </label>
              {values.group_policy === 'open' && (
                <p className="text-sm text-amber-600">
                  Open allows all groups through the group policy. Use an allowlist for a private assistant.
                </p>
              )}
              <label className="grid gap-1">
                Allowed groups
                <Input
                  aria-label="Allowed groups"
                  onChange={e => field('group_allow_from', e.target.value)}
                  value={values.group_allow_from ?? ''}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Comma-separated group IDs (ending in @g.us). An empty allowlist permits no groups under allowlist
                policy.
              </p>
              <label className="flex items-center justify-between gap-3">
                Require a mention in groups
                <Switch
                  aria-label="Require a mention in groups"
                  checked={values.require_mention ?? false}
                  onCheckedChange={v => field('require_mention', v)}
                />
              </label>
              <details className="grid gap-3">
                <summary className="cursor-pointer text-sm font-medium">Advanced group settings</summary>
                <div className="mt-3 grid gap-3">
                  <label className="grid gap-1">
                    Mention patterns
                    <textarea
                      aria-label="Mention patterns"
                      className="min-h-20 rounded-md border border-input bg-background p-2 text-sm"
                      onChange={e => field('mention_patterns', e.target.value.split('\n'))}
                      value={(values.mention_patterns ?? []).join('\n')}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    One case-insensitive regular expression per line. These count as mentions; invalid patterns cannot
                    be saved.
                  </p>
                  <label className="grid gap-1">
                    Chats that do not require a mention
                    <Input
                      aria-label="Chats that do not require a mention"
                      onChange={e => field('free_response_chats', e.target.value)}
                      value={values.free_response_chats ?? ''}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Comma-separated chat IDs. These exceptions do not bypass access policies.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Per-user conversation isolation is a gateway-wide setting, not a WhatsApp-only setting. This panel
                    does not change it.
                  </p>
                </div>
              </details>
            </fieldset>
          )}
          {values.send_read_receipts === undefined && (
            <p className="text-sm text-muted-foreground">
              Update this backend to manage read receipts and group behavior.
            </p>
          )}
          <div className="sticky bottom-0 flex flex-wrap gap-2 bg-background py-2">
            <Button disabled={busy || !Object.keys(edits).length} onClick={() => void save()}>
              Save changes
            </Button>
            <Button disabled={busy || !!Object.keys(edits).length} onClick={() => setRestart(true)} variant="secondary">
              Restart gateway to apply
            </Button>
          </div>
          {saved && (
            <p className="text-sm" role="status">
              Settings saved. Restart the gateway when ready to apply them. Your paired session was kept.
            </p>
          )}
          {!status.paired && (
            <div className="grid gap-2 text-sm">
              <h4 className="font-semibold">Pair with a QR code</h4>
              <WhatsAppPairing key={profile ?? 'primary'} mode={values.mode} onPaired={() => void refresh()} />
              <p>
                On this backend, run <code>hermes whatsapp</code> to use the existing interactive QR setup. For a remote
                connection, run it on the remote host in the same Hermes profile. Do not run setup against an already
                linked device.
              </p>
              <Button
                onClick={() =>
                  openExternalLink('https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp')
                }
                variant="secondary"
              >
                Open WhatsApp QR setup guide
              </Button>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        confirmLabel="Restart gateway"
        description="This briefly interrupts all messaging platforms and applies saved configuration. It does not log out or unpair WhatsApp."
        onClose={() => setRestart(false)}
        onConfirm={async () => {
          await runGatewayRestart()
          setRestart(false)
          void refresh()
        }}
        open={restart}
        title="Restart messaging gateway?"
      />
    </section>
  )
}
