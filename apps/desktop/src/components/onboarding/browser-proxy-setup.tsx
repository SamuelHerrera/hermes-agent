import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getHermesConfig, saveHermesConfig } from '@/hermes'
import { $gateway } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $desktopOnboarding } from '@/store/onboarding'
import type { HermesConfig } from '@/types/hermes'

interface BrowserProxySetupProps {
  enabled: boolean
  profile?: string
}

/** GUI installs skip TTY setup; offer the same optional origin after provider setup. */
export function BrowserProxySetup({ enabled, profile }: BrowserProxySetupProps) {
  const gateway = useStore($gateway)
  const onboarding = useStore($desktopOnboarding)
  const [signal, setSignal] = useState<AbortSignal | null>(null)
  const [config, setConfig] = useState<HermesConfig | null>(null)
  const [origin, setOrigin] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    setSignal(controller.signal)
    setConfig(null)
    setOrigin('')
    setDone(false)
    setBusy(false)
    setError(null)

    if (enabled) {
      void getHermesConfig(profile).then(value => {
        if (controller.signal.aborted) {
          return
        }

        setConfig(value)
        // Already configured, explicitly deferred, or an older backend without this feature.
        setDone(Boolean(value.desktop?.browser_proxy_origin) || value.desktop?.browser_proxy_setup_complete !== false || value.desktop?.browser_access_enabled === false)
      }).catch(cause => {
        if (!controller.signal.aborted) {
          notifyError(cause, 'Could not load PWA browser setup')
        }
      })
    }

    return () => controller.abort()
  }, [enabled, gateway, profile])

  const save = async (defer: boolean) => {
    if (!signal || signal.aborted || busy || $gateway.get() !== gateway) {
      return
    }

    setError(null)

    try {
      let canonical = ''

      if (!defer) {
        const url = new URL(origin.trim())

        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
          throw new Error('Enter a bare HTTPS origin, without a path, credentials, query or fragment.')
        }

        canonical = url.origin
      }

      setBusy(true)

      const result = await saveHermesConfig({ desktop: {
        ...(!defer ? { browser_proxy_origin: canonical } : {}),
        browser_proxy_setup_complete: true
      } }, profile)

      if (signal.aborted) {
        return
      }

      if (result.browser_proxy?.error) {
        throw new Error(`Settings saved, but the proxy could not start: ${result.browser_proxy.error}`)
      }

      setDone(true)
    } catch (cause) {
      if (!signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (!signal.aborted) {
        setBusy(false)
      }
    }
  }

  if (!enabled || !config || done || onboarding.manual || (onboarding.configured !== true && !onboarding.firstRunSkipped)) {
    return null
  }

  return (
    <Dialog open>
      <DialogContent onEscapeKeyDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()} showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Set up PWA browsing</DialogTitle>
          <DialogDescription>
            The proxy is included with Hermes. Websites render on your device; the connected backend carries their traffic without launching a browser.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(false) }}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="browser-proxy-origin">Separate HTTPS proxy origin</label>
            <Input autoComplete="off" className="min-h-11" disabled={busy} id="browser-proxy-origin" onChange={event => setOrigin(event.target.value)} placeholder="https://browser.example.net" required type="url" value={origin} />
            <p className="text-xs text-muted-foreground">
              Use a different hostname and registrable domain from Hermes. Route the entire HTTPS site, including WebSockets, to {config.desktop?.browser_proxy_bind ?? '127.0.0.1'}:{config.desktop?.browser_proxy_port ?? 9120} on this backend. Setup does not provision DNS or TLS.
            </p>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button className="min-h-11" disabled={busy} onClick={() => void save(true)} type="button" variant="outline">Set up later</Button>
            <Button className="min-h-11" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save and start'}</Button>
          </DialogFooter>
          <p className="text-xs text-muted-foreground">You can configure this later with <code>hermes setup browser</code>.</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
