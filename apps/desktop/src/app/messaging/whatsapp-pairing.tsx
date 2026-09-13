import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/error-state'
import { getApiRequestProfile } from '@/hermes'

type Pairing = { pairing_id: string; status: string; qr_image?: string | null; error?: string | null }
const terminal = new Set(['connected', 'error', 'expired', 'cancelled'])

export function WhatsAppPairing({ mode, onPaired }: { mode: string; onPaired: () => void }) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const profile = getApiRequestProfile()
  // Lifecycle guard only; this ref does not mirror reactive store values.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    alive.current = true

    return () => {
      alive.current = false
    }
  }, [])

  const request = useCallback(
    <T,>(path: string, method: 'POST' | 'GET' | 'DELETE') =>
      window.hermesDesktop.api<T>({
        path: `/api/messaging/whatsapp/onboarding/${path}`,
        method,
        ...(method === 'POST' ? { body: { mode } } : {}),
        ...(profile ? { profile } : {})
      }),
    [mode, profile]
  )

  const accept = useCallback(
    (next: Pairing) => {
      if (!alive.current || getApiRequestProfile() !== profile) {
        return
      }

      setPairing(next)

      if (next.status === 'connected') {
        onPaired()
      }
    },
    [profile, onPaired]
  )

  useEffect(() => {
    if (!pairing || terminal.has(pairing.status)) {
      return
    }

    let cancelled = false

    const timer = window.setTimeout(async () => {
      try {
        const next = await request<Pairing>(encodeURIComponent(pairing.pairing_id), 'GET')

        if (!cancelled) {
          accept(next)
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err))
          setPairing(null)
        }
      }
    }, 2000)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [pairing, request, accept])

  const start = async () => {
    setBusy(true)
    setError('')

    try {
      accept(await request<Pairing>('start', 'POST'))
    } catch (err) {
      if (alive.current) {
        setError(String(err))
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  const cancel = async () => {
    if (!pairing) {
      return
    }

    setBusy(true)

    try {
      await request(encodeURIComponent(pairing.pairing_id), 'DELETE')

      if (alive.current) {
        setPairing(null)
      }
    } catch (err) {
      if (alive.current) {
        setError(String(err))
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  return (
    <div className="grid gap-2">
      <p>
        Start setup, then open WhatsApp → Linked devices → Link a device and scan the QR. Setup expires after ten
        minutes. This does not enable the gateway or change your DM policy.
      </p>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {pairing?.error && <ErrorBanner>{pairing.error}</ErrorBanner>}
      {pairing && <p role="status">QR setup: {pairing.status}</p>}
      {pairing?.qr_image && !terminal.has(pairing.status) && (
        <img alt="WhatsApp pairing QR code" className="size-64 bg-white p-2" src={pairing.qr_image} />
      )}
      {pairing?.status === 'waiting' && !pairing.qr_image && (
        <p>QR rendering is unavailable on this backend. Use the CLI setup guide below.</p>
      )}
      {!pairing || terminal.has(pairing.status) ? (
        <Button disabled={busy} onClick={() => void start()}>
          Start QR pairing
        </Button>
      ) : (
        <Button disabled={busy} onClick={() => void cancel()} variant="secondary">
          Cancel QR setup
        </Button>
      )}
    </div>
  )
}
