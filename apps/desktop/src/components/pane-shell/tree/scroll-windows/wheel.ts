export interface ScrollWheelAxisState {
  axis: 'horizontal' | 'vertical' | null
  cumulativeX: number
  cumulativeY: number
  lastEventAt: number
}

export const createScrollWheelAxisState = (): ScrollWheelAxisState => ({
  axis: null,
  cumulativeX: 0,
  cumulativeY: 0,
  lastEventAt: 0
})

const GESTURE_RESET_MS = 180
const MIN_AXIS_DELTA = 8
const HORIZONTAL_DOMINANCE = 1.1
const VERTICAL_DOMINANCE = 1.35

function resetGesture(state: ScrollWheelAxisState): void {
  state.axis = null
  state.cumulativeX = 0
  state.cumulativeY = 0
}

export function scrollWindowHorizontalDelta(event: WheelEvent, state: ScrollWheelAxisState): number {
  const now = event.timeStamp || performance.now()
  const deltaX = event.deltaX
  const deltaY = event.deltaY
  const absX = Math.abs(deltaX)
  const absY = Math.abs(deltaY)

  if (now - state.lastEventAt > GESTURE_RESET_MS) {
    resetGesture(state)
  }

  state.lastEventAt = now

  if (event.shiftKey && absY > 0) {
    state.axis = 'horizontal'

    return deltaY
  }

  if (state.axis === 'vertical') {
    return 0
  }

  if (state.axis === 'horizontal') {
    return deltaX
  }

  state.cumulativeX += absX
  state.cumulativeY += absY

  if (state.cumulativeX >= MIN_AXIS_DELTA && state.cumulativeX >= state.cumulativeY * HORIZONTAL_DOMINANCE) {
    state.axis = 'horizontal'

    return deltaX
  }

  if (state.cumulativeY >= MIN_AXIS_DELTA && state.cumulativeY >= state.cumulativeX * VERTICAL_DOMINANCE) {
    state.axis = 'vertical'
  }

  return 0
}

export function consumeScrollWindowWheel(
  event: WheelEvent,
  viewport: HTMLElement,
  state: ScrollWheelAxisState
): boolean {
  const horizontalDelta = scrollWindowHorizontalDelta(event, state)

  if (horizontalDelta === 0) {
    return false
  }

  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)

  if (maxScrollLeft === 0) {
    return false
  }

  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, viewport.scrollLeft + horizontalDelta))

  if (nextScrollLeft === viewport.scrollLeft) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  viewport.scrollLeft = nextScrollLeft

  return true
}
