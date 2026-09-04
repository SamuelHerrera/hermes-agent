import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  STREAMING_TEXT_CADENCE_MS,
  STREAMING_TEXT_CATCHUP_CHARS,
  STREAMING_TEXT_THRESHOLD_CHARS,
  useStreamingTextCadence
} from './streaming-text-cadence'

function Harness({ running, text }: { running: boolean; text: string }) {
  return <output data-testid="value">{useStreamingTextCadence(text, running)}</output>
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useStreamingTextCadence', () => {
  it('renders ordinary short streams immediately', () => {
    const { rerender } = render(<Harness running text="short" />)

    rerender(<Harness running text="short update" />)

    expect(screen.getByTestId('value').textContent).toBe('short update')
  })

  it('coalesces small appends to a long running message', () => {
    vi.useFakeTimers()
    const base = 'a'.repeat(STREAMING_TEXT_THRESHOLD_CHARS)
    const { rerender } = render(<Harness running text={base} />)

    rerender(<Harness running text={`${base} first`} />)
    rerender(<Harness running text={`${base} first second`} />)

    expect(screen.getByTestId('value').textContent).toBe(base)

    act(() => vi.advanceTimersByTime(STREAMING_TEXT_CADENCE_MS))

    expect(screen.getByTestId('value').textContent).toBe(`${base} first second`)
  })

  it('renders a large catch-up update immediately', () => {
    vi.useFakeTimers()
    const base = 'a'.repeat(STREAMING_TEXT_THRESHOLD_CHARS)
    const catchup = `${base}${'b'.repeat(STREAMING_TEXT_CATCHUP_CHARS + 1)}`
    const { rerender } = render(<Harness running text={base} />)

    rerender(<Harness running text={catchup} />)

    expect(screen.getByTestId('value').textContent).toBe(catchup)
  })

  it('renders final content immediately and cannot regress from a pending timer', () => {
    vi.useFakeTimers()
    const base = 'a'.repeat(STREAMING_TEXT_THRESHOLD_CHARS)
    const pending = `${base} pending`
    const final = `${pending} final`
    const { rerender } = render(<Harness running text={base} />)

    rerender(<Harness running text={pending} />)
    expect(screen.getByTestId('value').textContent).toBe(base)

    rerender(<Harness running={false} text={final} />)
    expect(screen.getByTestId('value').textContent).toBe(final)

    act(() => vi.advanceTimersByTime(STREAMING_TEXT_CADENCE_MS * 2))
    expect(screen.getByTestId('value').textContent).toBe(final)
  })

  it('renders non-append rewrites immediately', () => {
    vi.useFakeTimers()
    const base = 'a'.repeat(STREAMING_TEXT_THRESHOLD_CHARS)
    const replacement = 'b'.repeat(STREAMING_TEXT_THRESHOLD_CHARS + 20)
    const { rerender } = render(<Harness running text={base} />)

    rerender(<Harness running text={replacement} />)

    expect(screen.getByTestId('value').textContent).toBe(replacement)
  })
})
