import type { ComponentProps } from 'react'

import { scrollWindowColorBackground, useScrollWindowColor } from './window-color'

interface ScrollWindowHeaderProps extends ComponentProps<'div'> {
  windowId: string
}

/** Color belongs to the card's project, not whichever chat happens to be active.
 * Keep these subscriptions in the small header, away from the pane renderer. */
export function ScrollWindowHeader({ windowId, style, ...props }: ScrollWindowHeaderProps) {
  const color = useScrollWindowColor(windowId)

  return (
    <div
      {...props}
      data-scroll-window-project-color={color ?? undefined}
      style={{
        ...style,
        ...(color
          ? {
              backgroundColor: scrollWindowColorBackground(color),
              borderBottomColor: `color-mix(in srgb, ${color} 60%, var(--ui-stroke-tertiary))`
            }
          : {})
      }}
    />
  )
}
