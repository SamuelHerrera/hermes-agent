import type { ComponentProps, Key } from 'react'

import { cn } from '@/lib/utils'

interface ShimmerPulseProps extends ComponentProps<'span'> {
  /** Changing the key remounts the span so newly-arrived activity gets one fresh sweep. */
  pulseKey?: Key
}

/**
 * A bounded version of the text shimmer.
 *
 * `tw-shimmer` defaults to an infinite background-position animation, which
 * keeps the renderer and GPU process active for as long as a status is live.
 * One sweep preserves the visual state transition while allowing both
 * processes to sleep afterward. Change `pulseKey` to replay for new activity.
 */
export function ShimmerPulse({ children, className, pulseKey, style, ...props }: ShimmerPulseProps) {
  return (
    <span
      {...props}
      className={cn('shimmer', className)}
      key={pulseKey}
      style={{ ...style, animationFillMode: 'both', animationIterationCount: 1 }}
    >
      {children}
    </span>
  )
}
