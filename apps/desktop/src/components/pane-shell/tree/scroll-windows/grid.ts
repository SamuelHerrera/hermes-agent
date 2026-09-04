export interface ScrollGridInput {
  viewportWidth: number
  viewportHeight: number
  windowCount: number
  minWindowWidth: number
  minWindowHeight: number
  gap: number
  rows?: number
}

export interface ScrollGridLayout {
  columns: number
  rows: number
  windowWidth: number
  windowHeight: number
  viewportWidth: number
  viewportHeight: number
  canvasWidth: number
  canvasHeight: number
}

/**
 * Deterministic scroll-window grid generator.
 *
 * By default this is a horizontal strip: new windows extend to the right and
 * the workspace scrolls horizontally. Additional rows are explicit user state
 * (drag placement / future hotkeys), never a side effect of adding windows or
 * resizing the viewport.
 */
export function generateScrollGrid({
  gap,
  minWindowHeight,
  minWindowWidth,
  rows: requestedRows = 1,
  viewportHeight,
  viewportWidth,
  windowCount
}: ScrollGridInput): ScrollGridLayout {
  const count = Math.max(1, Math.floor(windowCount))
  const width = Math.max(minWindowWidth, Math.floor(viewportWidth))
  const height = Math.max(minWindowHeight, Math.floor(viewportHeight))
  const spacing = Math.max(0, gap)
  const rows = Math.max(1, Math.min(count, Math.floor(requestedRows)))
  const columns = Math.ceil(count / rows)
  const windowWidth = width

  const windowHeight = Math.max(minWindowHeight, Math.floor((height - spacing * Math.max(0, rows - 1)) / rows))

  return {
    canvasHeight: rows * windowHeight + spacing * Math.max(0, rows - 1),
    canvasWidth: columns * windowWidth + spacing * Math.max(0, columns - 1),
    columns,
    rows,
    viewportHeight: height,
    viewportWidth: width,
    windowHeight,
    windowWidth
  }
}

export function scrollGridWindowRect(layout: ScrollGridLayout, index: number, gap: number) {
  const column = index % layout.columns
  const row = Math.floor(index / layout.columns)

  return {
    height: layout.windowHeight,
    left: column * (layout.windowWidth + gap),
    top: row * (layout.windowHeight + gap),
    width: layout.windowWidth
  }
}
