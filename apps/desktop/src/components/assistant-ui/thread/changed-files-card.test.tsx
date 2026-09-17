import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { openPreview, normalize } = vi.hoisted(() => ({ openPreview: vi.fn(), normalize: vi.fn() }))
vi.mock('@/app/chat/session-view', () => ({ useSessionView: () => ({ kind: 'tile', $cwd: atom('/tile/repo') }) }))
vi.mock('@/lib/local-preview', () => ({ normalizeOrLocalPreviewTarget: normalize }))
vi.mock('@/store/preview', () => ({ openPreview }))

import { ChangedFilesCard } from './changed-files-card'

const parts = [
  {
    type: 'tool-call',
    toolName: 'patch',
    args: { path: 'src/example.ts' },
    result: { diff: '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new' }
  }
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('changed files without native Git review', () => {
  it('keeps scoped file preview and file actions, without review buttons or menu items', async () => {
    const target = { kind: 'file', path: '/tile/repo/src/example.ts' }
    normalize.mockResolvedValue(target)
    render(<ChangedFilesCard parts={parts} />)
    expect(screen.queryByRole('button', { name: /^review/i })).toBeNull()
    const file = screen.getByRole('button', { name: /example.ts/ })
    fireEvent.click(file)
    await waitFor(() => expect(openPreview).toHaveBeenCalledWith(target, 'file-browser', undefined))
    expect(normalize).toHaveBeenCalledWith('src/example.ts', '/tile/repo')
    fireEvent.contextMenu(file)
    expect(screen.getByRole('menuitem', { name: 'Open File' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copy Path' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /open changes/i })).toBeNull()
  })
})
