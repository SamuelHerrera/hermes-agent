import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $previewTabs } from '@/store/preview'
import { $currentCwd } from '@/store/session'

import { MarkdownTextContent } from './markdown-text'

const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
const initialHermesDesktop = desktopWindow.hermesDesktop
const cwd = '/Users/samuel/project'

function installDesktopBridge() {
  desktopWindow.hermesDesktop = {
    fetchLinkTitle: vi.fn().mockResolvedValue(''),
    normalizePreviewTarget: vi.fn(async (target: string, baseDir?: string) => {
      const path = target.startsWith('/') ? target : `${baseDir}/${target}`
      const binary = path.endsWith('.xlsx')

      return {
        binary,
        kind: 'file',
        label: path.split('/').pop() || path,
        language: binary ? 'text' : 'markdown',
        path,
        previewKind: binary ? 'binary' : 'text',
        source: target,
        url: `file://${path}`
      }
    }),
    openExternal: vi.fn().mockResolvedValue(undefined),
    revealPath: vi.fn().mockResolvedValue(true),
    writeClipboard: vi.fn().mockResolvedValue(true)
  } as unknown as Window['hermesDesktop']
}

function openContextMenu(target: HTMLElement) {
  fireEvent.pointerDown(target, { button: 2, pointerType: 'mouse' })
  fireEvent.contextMenu(target, { button: 2 })
}

beforeEach(() => {
  installDesktopBridge()
  $currentCwd.set(cwd)
  $previewTabs.set([])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  $previewTabs.set([])

  if (initialHermesDesktop) {
    desktopWindow.hermesDesktop = initialHermesDesktop
  } else {
    delete desktopWindow.hermesDesktop
  }
})

describe('chat file links', () => {
  it('makes an inline relative file path clickable and gives it the complete file context menu', async () => {
    const relativePath = 'docs/investigations/archer-click-feed-zip-fallback-2026-08-25.md'
    const absolutePath = `${cwd}/${relativePath}`

    render(<MarkdownTextContent isRunning={false} text={`Saved the complete finding: \`${relativePath}\``} />)

    const link = await screen.findByRole('link', { name: relativePath })

    fireEvent.click(link)

    await waitFor(() => {
      expect($previewTabs.get().at(-1)?.target).toMatchObject({ path: absolutePath, source: relativePath })
    })

    openContextMenu(link)

    expect(await screen.findByRole('menuitem', { name: 'Open File' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Open Outside' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Reveal in filetree' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Open Containing Folder' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copy Path' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copy Relative Path' })).toBeTruthy()
  })

  it('treats a relative markdown href as the same actionable internal file link', async () => {
    const relativePath = 'reports/quarterly-summary.md'

    render(<MarkdownTextContent isRunning={false} text={`[Quarterly summary](${relativePath})`} />)

    const link = await screen.findByRole('link', { name: 'Quarterly summary' })

    fireEvent.click(link)

    await waitFor(() => {
      expect($previewTabs.get().at(-1)?.target).toMatchObject({
        path: `${cwd}/${relativePath}`,
        source: relativePath
      })
    })

    openContextMenu(link)
    expect(await screen.findByRole('menuitem', { name: 'Open Containing Folder' })).toBeTruthy()
  })

  it('makes a scheme-less external markdown href clickable with open and copy link actions', async () => {
    const openExternal = desktopWindow.hermesDesktop?.openExternal as ReturnType<typeof vi.fn>
    const writeClipboard = desktopWindow.hermesDesktop?.writeClipboard as ReturnType<typeof vi.fn>

    render(<MarkdownTextContent isRunning={false} text="[External docs](www.example.com/guide.pdf)" />)

    const link = await screen.findByRole('link', { name: 'External docs' })

    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith('https://www.example.com/guide.pdf')

    openContextMenu(link)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy Link' }))
    expect(writeClipboard).toHaveBeenCalledWith('https://www.example.com/guide.pdf')
  })

  it('keeps an Excel MEDIA file opening in its external app and adds containing-folder actions', async () => {
    const path = '/Users/samuel/Downloads/report.xlsx'
    const openExternal = desktopWindow.hermesDesktop?.openExternal as ReturnType<typeof vi.fn>
    const revealPath = desktopWindow.hermesDesktop?.revealPath as ReturnType<typeof vi.fn>

    render(
      <MarkdownTextContent
        isRunning={false}
        text={`[File: report.xlsx](#media:${encodeURIComponent(path)})`}
      />
    )

    const link = await screen.findByRole('link', { name: 'Open report.xlsx' })

    fireEvent.click(link)
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('file:///Users/samuel/Downloads/report.xlsx'))

    openContextMenu(link)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open Containing Folder' }))
    await waitFor(() => expect(revealPath).toHaveBeenCalledWith(path))
  })
})
