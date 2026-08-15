import { useEffect, useState } from 'react'

import type { CodexUsageControlState, CodexUsageData } from './codex-usage-control'

export const CODEX_USAGE_REFRESH_MS = 120_000

type DesktopCodexUsageSnapshot = Awaited<ReturnType<NonNullable<Window['hermesDesktop']['codexUsage']>['get']>>

interface UseCodexUsageOptions {
  enabled: boolean
  profile?: null | string
}

interface UseCodexUsageResult {
  state: CodexUsageControlState
  usage: CodexUsageData | null
}

const UNAVAILABLE_USAGE: UseCodexUsageResult = Object.freeze({
  state: 'unavailable',
  usage: null
})

export function useCodexUsage({ enabled, profile }: UseCodexUsageOptions): UseCodexUsageResult {
  const [result, setResult] = useState<UseCodexUsageResult>(UNAVAILABLE_USAGE)

  useEffect(() => {
    const client = window.hermesDesktop?.codexUsage

    if (!enabled || !client) {
      setResult(UNAVAILABLE_USAGE)

      return
    }

    let stopped = false

    const refresh = async () => {
      try {
        const snapshot = await client.get(profile)

        if (stopped) {
          return
        }

        setResult(mapCodexUsageSnapshot(snapshot))
      } catch {
        if (!stopped) {
          setResult(UNAVAILABLE_USAGE)
        }
      }
    }

    setResult(UNAVAILABLE_USAGE)
    void refresh()

    const interval = window.setInterval(() => void refresh(), CODEX_USAGE_REFRESH_MS)

    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [enabled, profile])

  return result
}

export function mapCodexUsageSnapshot(snapshot: DesktopCodexUsageSnapshot | null | undefined): UseCodexUsageResult {
  if (!snapshot?.available || snapshot.status !== 'available') {
    return UNAVAILABLE_USAGE
  }

  return {
    state: 'available',
    usage: {
      available: true,
      buckets: snapshot.buckets.map(bucket => ({
        id: bucket.key,
        label: bucket.label || bucket.key || 'Usage bucket',
        remainingPercent: bucket.remaining_percent,
        resetAt: bucket.reset_time,
        usedPercent: bucket.used_percent
      })),
      plan: snapshot.plan,
      remainingPercent: snapshot.remaining_percent,
      resetAt: snapshot.reset_time,
      resetCredits: snapshot.reset_credits,
      usedPercent: snapshot.used_percent
    }
  }
}
