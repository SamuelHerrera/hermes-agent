import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ProjectTree } from './tree'
import { projectTreeViewKey, readProjectTreeView, saveProjectTreeView } from './view-state'

vi.mock('../file-actions', () => ({
  FileEntryContextMenu: ({ children }: { children: React.ReactNode }) => children,
  InlineRenameInput: () => null,
  isRenameShortcut: () => false
}))
vi.mock('@/hooks/use-resize-observer', async () => {
  const { useLayoutEffect } = await import('react')

  return {
    useResizeObserver: (callback: (entries: unknown[]) => void, ref: { current: HTMLElement }) => {
      useLayoutEffect(
        () => callback([{ target: ref.current, contentRect: { height: 200, width: 250 } }]),
        [callback, ref]
      )
    }
  }
})

beforeEach(() => localStorage.clear())
afterEach(cleanup)

it('restores each folder scroll offset after remount without overwriting it with the initial zero event', async () => {
  const key = projectTreeViewKey('/a')
  saveProjectTreeView(key, { scrollTop: 660 })

  const props = {
    collapseNonce: 0,
    cwd: '/a',
    viewKey: key,
    data: Array.from({ length: 100 }, (_, i) => ({ id: `/a/${i}`, name: `file-${i}`, isDirectory: false })),
    openState: {},
    onActivateFile: vi.fn(),
    onActivateFolder: vi.fn(),
    onLoadChildren: vi.fn(),
    onNodeOpenChange: vi.fn()
  }

  const first = render(<ProjectTree {...props} />)
  const viewport = first.container.querySelector('[role="tree"] > div') as HTMLElement
  await waitFor(() => expect(viewport.scrollTop).toBe(660))
  Object.defineProperty(viewport, 'scrollHeight', { value: 2200 })
  Object.defineProperty(viewport, 'clientHeight', { value: 200 })
  act(() => {
    viewport.scrollTop = 990
    fireEvent.scroll(viewport)
  })
  first.unmount()
  expect(readProjectTreeView(key).scrollTop).toBe(990)
  const other = render(<ProjectTree {...props} cwd="/b" viewKey={projectTreeViewKey('/b')} />)
  expect((other.container.querySelector('[role="tree"] > div') as HTMLElement).scrollTop).toBe(0)
  other.unmount()
  const restored = render(<ProjectTree {...props} />)
  await waitFor(() =>
    expect((restored.container.querySelector('[role="tree"] > div') as HTMLElement).scrollTop).toBe(990)
  )
})
