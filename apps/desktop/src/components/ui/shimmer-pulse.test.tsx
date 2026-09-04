import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ShimmerPulse } from './shimmer-pulse'

describe('ShimmerPulse', () => {
  it('runs the shimmer once and keeps caller styling', () => {
    render(
      <ShimmerPulse className="custom" style={{ color: 'rgb(255, 0, 0)' }}>
        Working
      </ShimmerPulse>
    )

    const pulse = screen.getByText('Working')
    expect([...pulse.classList]).toEqual(expect.arrayContaining(['shimmer', 'custom']))
    expect(pulse.style.animationIterationCount).toBe('1')
    expect(pulse.style.animationFillMode).toBe('both')
    expect(pulse.style.color).toBe('rgb(255, 0, 0)')
  })

  it('remounts for a new pulse key so updated activity replays once', () => {
    const { rerender } = render(<ShimmerPulse pulseKey="reading">Reading</ShimmerPulse>)
    const first = screen.getByText('Reading')

    rerender(<ShimmerPulse pulseKey="writing">Writing</ShimmerPulse>)

    expect(screen.getByText('Writing')).not.toBe(first)
  })

  it('does not let caller styles restore an infinite animation', () => {
    render(
      <ShimmerPulse style={{ animationFillMode: 'none', animationIterationCount: 'infinite' }}>
        Bounded
      </ShimmerPulse>
    )

    const pulse = screen.getByText('Bounded')
    expect(pulse.style.animationIterationCount).toBe('1')
    expect(pulse.style.animationFillMode).toBe('both')
  })
})
