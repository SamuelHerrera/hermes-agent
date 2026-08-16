import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CODEX_USAGE_REFRESH_MS, mapCodexUsageSnapshot, useCodexUsage } from './use-codex-usage'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function availableUsage(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    buckets: [
      {
        detail: null,
        key: 'primary',
        label: 'Primary window',
        remaining_percent: 68,
        reset_time: '2026-08-15T12:00:00Z',
        used_percent: 32
      }
    ],
    plan: 'Pro',
    provider: 'openai-codex' as const,
    remaining_percent: 68,
    reset_credits: 1,
    reset_time: '2026-08-15T12:00:00Z',
    status: 'available' as const,
    used_percent: 32,
    ...overrides
  }
}

function withLocalClock(timeZone: string, now: string, callback: () => void) {
  const previousTimeZone = process.env.TZ
  process.env.TZ = timeZone
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))

  try {
    callback()
  } finally {
    if (previousTimeZone === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = previousTimeZone
    }
  }
}

describe('useCodexUsage', () => {
  it('maps the sanitized Desktop RPC payload into the titlebar control shape', () => {
    const result = mapCodexUsageSnapshot(
      availableUsage({
        account_id: 'acct_should_not_escape',
        authorization: 'Bearer should-not-escape',
        base_url: 'https://chatgpt.com/backend-api/codex',
        session_token: 'token_should_not_escape'
      })
    )

    expect(result.state).toBe('available')
    expect(result.usage).toMatchObject({
      plan: 'Pro',
      remainingPercent: 68,
      resetAt: expect.any(String),
      resetCredits: 1,
      usedPercent: 32,
      buckets: [
        {
          id: 'primary',
          label: 'Primary window',
          remainingPercent: 68,
          resetAt: expect.any(String),
          usedPercent: 32
        }
      ]
    })
    const encoded = JSON.stringify(result.usage)
    expect(encoded).not.toContain('acct_should_not_escape')
    expect(encoded).not.toContain('should-not-escape')
    expect(encoded).not.toContain('chatgpt.com')
    expect(encoded).not.toContain('token_should_not_escape')
  })

  it('formats UTC reset instants on the viewer local calendar day across UTC/local date boundaries', () => {
    withLocalClock('America/Mexico_City', '2026-08-15T07:00:00Z', () => {
      const result = mapCodexUsageSnapshot(
        availableUsage({
          buckets: [
            {
              detail: null,
              key: 'primary',
              label: 'Primary window',
              remaining_percent: 68,
              reset_time: '2026-08-20T03:32:23+00:00',
              used_percent: 32
            }
          ],
          reset_time: '2026-08-20T03:32:23+00:00'
        })
      )

      expect(result.usage?.resetAt).toBe('in 4d 20h (2026-08-19 21:32)')
      expect(result.usage?.buckets?.[0]?.resetAt).toBe('in 4d 20h (2026-08-19 21:32)')
    })
  })

  it('formats UTC reset instants on the viewer local calendar day for same-day resets', () => {
    withLocalClock('America/Mexico_City', '2026-08-15T07:00:00Z', () => {
      const result = mapCodexUsageSnapshot(availableUsage({ reset_time: '2026-08-15T12:30:00+00:00' }))

      expect(result.usage?.resetAt).toBe('in 5h 30m (2026-08-15 06:30)')
    })
  })

  it('fetches usage from the sanitized backend bridge for the active profile', async () => {
    const get = vi.fn().mockResolvedValue(availableUsage())
    vi.stubGlobal('hermesDesktop', { codexUsage: { get } })

    const { result } = renderHook(() => useCodexUsage({ enabled: true, profile: 'default' }))

    await waitFor(() => expect(result.current.state).toBe('available'))
    expect(get).toHaveBeenCalledWith('default')
    expect(result.current.usage?.remainingPercent).toBe(68)
  })

  it('fails open to unavailable without throwing when the bridge rejects', async () => {
    const get = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('hermesDesktop', { codexUsage: { get } })

    const { result } = renderHook(() => useCodexUsage({ enabled: true, profile: 'default' }))

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    expect(result.current).toEqual({ state: 'unavailable', usage: null })
  })

  it('refreshes at a conservative subscription-usage interval instead of hot polling', async () => {
    vi.useFakeTimers()
    const get = vi.fn().mockResolvedValue(availableUsage())
    vi.stubGlobal('hermesDesktop', { codexUsage: { get } })

    renderHook(() => useCodexUsage({ enabled: true, profile: 'default' }))

    expect(get).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CODEX_USAGE_REFRESH_MS - 1)
    })
    expect(get).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(get).toHaveBeenCalledTimes(2)
  })
})
