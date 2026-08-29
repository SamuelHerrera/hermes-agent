import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { codexUsageRemainingPercent, codexUsageResetProgress, CodexUsageTitlebarControl } from './codex-usage-control'

afterEach(cleanup)

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

describe('CodexUsageTitlebarControl', () => {
  it('computes remaining percent from used percent and clamps the result', () => {
    expect(codexUsageRemainingPercent({ usedPercent: 23 })).toBe(77)
    expect(codexUsageRemainingPercent({ usedPercent: 140 })).toBe(0)
    expect(codexUsageRemainingPercent({ usedPercent: -12 })).toBe(100)
    expect(codexUsageRemainingPercent({ remainingPercent: 42, usedPercent: 90 })).toBe(42)
  })

  it('computes reset arc progress from raw reset time and window length', () => {
    expect(
      codexUsageResetProgress(
        {
          resetAtRaw: '2026-08-15T12:00:00Z',
          resetWindowMs: 24 * 60 * 60 * 1000
        },
        new Date('2026-08-15T06:00:00Z').getTime()
      )
    ).toBe(0.75)
  })

  it('falls back to a long reset window when older payloads omit the backend window length', () => {
    expect(
      codexUsageResetProgress(
        {
          resetAtRaw: '2026-09-01T12:00:00Z',
          resetWindowMs: 5 * 60 * 60 * 1000
        },
        new Date('2026-08-27T12:00:00Z').getTime()
      )
    ).toBeCloseTo(2 / 7, 4)
  })

  it('renders a compact usage icon trigger whose fill is remaining usage', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))

    try {
      render(
        <CodexUsageTitlebarControl
          usage={{
            plan: 'Pro',
            resetAtRaw: '2026-09-01T12:00:00Z',
            resetWindowMs: 7 * 24 * 60 * 60 * 1000,
            usedPercent: 25
          }}
        />
      )

      expect(screen.getByRole('button', { name: /Codex usage: 75% allowance left/ })).toBeTruthy()
      expect(screen.getByTestId('codex-usage-fill').getAttribute('height')).toBe('7.875')
      expect(screen.getByTestId('codex-usage-fill').getAttribute('y')).toBe('9.375')
      expect(screen.getByTestId('codex-usage-reset-progress').tagName.toLowerCase()).toBe('path')
      expect(screen.getByTestId('codex-usage-reset-progress').getAttribute('d')).toMatch(/^M 12 3 A 9 9/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the detail popover on keyboard focus and renders supplied usage details', async () => {
    const resetAtRaw = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const { container } = render(
      <CodexUsageTitlebarControl
        usage={{
          buckets: [
            {
              id: 'burst',
              label: 'Burst requests',
              resetAt: '13:00 UTC',
              resetCredits: 20,
              usedPercent: 40
            },
            {
              id: 'weekly',
              label: 'Weekly messages',
              resetAt: 'Monday 00:00 UTC',
              usedPercent: 50
            }
          ],
          plan: 'Team',
          resetAt: 'Tomorrow 09:00 UTC',
          resetAtRaw,
          resetCredits: 120,
          resetWindowMs: 2 * 24 * 60 * 60 * 1000,
          usedPercent: 35
        }}
      />
    )

    fireEvent.focus(screen.getByRole('button', { name: /Codex usage: 65% allowance left/ }))

    expect(await screen.findByText('65% left')).toBeTruthy()
    expect(screen.getByText('Team')).toBeTruthy()
    expect(screen.getByText('35% used')).toBeTruthy()
    expect(screen.getByText('Tomorrow 09:00 UTC')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
    expect(screen.getByText('Burst requests')).toBeTruthy()
    expect(screen.getByText('60% left')).toBeTruthy()
    expect(screen.getByText('20 credits')).toBeTruthy()
    expect(screen.getByText('Weekly messages')).toBeTruthy()
    expect(screen.getByText('50% left')).toBeTruthy()
    expect(screen.getByText('Monday 00:00 UTC')).toBeTruthy()
    expect(
      [...container.querySelectorAll('svg')].every(svg => svg.style.getPropertyValue('--codex-usage-remaining-color'))
    ).toBe(true)
    const resetPaths = screen.getAllByTestId('codex-usage-reset-progress').map(path => path.getAttribute('d'))
    expect(resetPaths).toHaveLength(2)
    expect(resetPaths[0]).toMatch(/^M 12 3 A 9 9/)
    expect(resetPaths[1]).toBe(resetPaths[0])
  })

  it('does not toggle the hover popover from trigger clicks and closes on blur', () => {
    vi.useFakeTimers()

    try {
      render(<CodexUsageTitlebarControl usage={{ plan: 'Pro', usedPercent: 25 }} />)

      const button = screen.getByRole('button', { name: /Codex usage: 75% allowance left/ })
      fireEvent.pointerEnter(button)
      expect(screen.getByText('Pro')).toBeTruthy()

      fireEvent.click(button)
      expect(screen.getByText('Pro')).toBeTruthy()

      fireEvent.blur(button, { relatedTarget: button.ownerDocument.body })
      act(() => {
        vi.advanceTimersByTime(80)
      })
      expect(screen.queryByText('Pro')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders unavailable and hidden states without requiring usage data', async () => {
    const { rerender } = render(<CodexUsageTitlebarControl state="unavailable" usage={null} />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Codex usage unavailable' }))
    expect(await screen.findByText('Unavailable')).toBeTruthy()
    expect(screen.getByText('Codex subscription usage is not available.')).toBeTruthy()

    rerender(<CodexUsageTitlebarControl state="hidden" usage={null} />)
    expect(screen.queryByRole('button', { name: /Codex usage/ })).toBeNull()
  })
})
