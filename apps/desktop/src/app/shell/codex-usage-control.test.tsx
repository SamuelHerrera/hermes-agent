import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { codexUsageRemainingPercent, CodexUsageTitlebarControl } from './codex-usage-control'

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

  it('renders a compact battery trigger whose fill is remaining usage', () => {
    render(<CodexUsageTitlebarControl usage={{ plan: 'Pro', usedPercent: 25 }} />)

    expect(screen.getByRole('button', { name: 'Codex subscription usage' })).toBeTruthy()
    expect(screen.getByTestId('codex-usage-fill').style.width).toBe('75%')
  })

  it('opens the detail popover on keyboard focus and renders supplied usage details', async () => {
    render(
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
          resetCredits: 120,
          usedPercent: 35
        }}
      />
    )

    fireEvent.focus(screen.getByRole('button', { name: 'Codex subscription usage' }))

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
  })

  it('does not toggle the hover popover from trigger clicks and closes on blur', () => {
    vi.useFakeTimers()

    try {
      render(<CodexUsageTitlebarControl usage={{ plan: 'Pro', usedPercent: 25 }} />)

      const button = screen.getByRole('button', { name: 'Codex subscription usage' })
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

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Codex subscription usage' }))
    expect(await screen.findByText('Unavailable')).toBeTruthy()
    expect(screen.getByText('Codex subscription usage is not available.')).toBeTruthy()

    rerender(<CodexUsageTitlebarControl state="hidden" usage={null} />)
    expect(screen.queryByRole('button', { name: 'Codex subscription usage' })).toBeNull()
  })
})
