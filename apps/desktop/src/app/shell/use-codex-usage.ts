import { useEffect, useState } from 'react'

import type { CodexUsageControlState, CodexUsageData } from './codex-usage-control'

export const CODEX_USAGE_REFRESH_MS = 120_000

const SECOND_MS = 1000
const HOUR_MS = 60 * 60 * SECOND_MS
const DAY_MS = 24 * HOUR_MS

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

  const buckets = snapshot.buckets.map(bucket => ({
    id: bucket.key,
    label: bucket.label || bucket.key || 'Usage bucket',
    remainingPercent: bucket.remaining_percent,
    resetAt: formatCodexResetTime(bucket.reset_time),
    resetAtRaw: bucket.reset_time,
    resetWindowMs: codexResetWindowMs(bucket.key, bucket.label),
    usedPercent: bucket.used_percent
  }))

  const primaryResetWindowMs = buckets[0]?.resetWindowMs ?? codexResetWindowMs(null, null)

  return {
    state: 'available',
    usage: {
      available: true,
      buckets,
      plan: snapshot.plan,
      remainingPercent: snapshot.remaining_percent,
      resetAt: formatCodexResetTime(snapshot.reset_time),
      resetAtRaw: snapshot.reset_time,
      resetCredits: snapshot.reset_credits,
      resetWindowMs: primaryResetWindowMs,
      usedPercent: snapshot.used_percent
    }
  }
}

function codexResetWindowMs(key?: null | string, label?: null | string): number {
  const token = `${key ?? ''} ${label ?? ''}`.toLowerCase()

  if (token.includes('weekly')) {
    return 7 * DAY_MS
  }

  if (token.includes('daily')) {
    return DAY_MS
  }

  return 5 * HOUR_MS
}

export function formatCodexResetTime(resetTime: null | string | undefined, nowMs = Date.now()): null | string {
  if (resetTime == null || resetTime === '') {
    return resetTime ?? null
  }

  const resetDate = new Date(resetTime)
  const resetMs = resetDate.getTime()

  if (!Number.isFinite(resetMs)) {
    return resetTime
  }

  const localReset = formatLocalResetDate(resetDate)
  const totalSeconds = Math.floor((resetMs - nowMs) / SECOND_MS)

  if (totalSeconds <= 0) {
    return `now (${localReset})`
  }

  const totalMinutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24

    return `in ${days}d ${remainingHours}h (${localReset})`
  }

  if (hours > 0) {
    return `in ${hours}h ${minutes}m (${localReset})`
  }

  return `in ${minutes}m (${localReset})`
}

function formatLocalResetDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(
    date.getMinutes()
  )}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
