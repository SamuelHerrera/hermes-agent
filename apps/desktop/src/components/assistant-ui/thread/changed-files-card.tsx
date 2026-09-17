import { useStore } from '@nanostores/react'
import { type FC, type ReactNode, useCallback, useMemo } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { type ChangedFile, deriveChangedFiles } from '@/components/assistant-ui/thread/changed-files'
import { WIDGET_SHELL_CLASS } from '@/components/chat/widget-shell'
import { defaultOpenPaneAnchor } from '@/components/pane-shell/tree/store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { DiffCount } from '@/components/ui/diff-count'
import { FadeScroll } from '@/components/ui/fade-scroll'
import { FileTypeIcon } from '@/components/ui/file-type-icon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { isDesktopFsRemoteMode, openDesktopPath } from '@/lib/desktop-fs'
import { displayPath } from '@/lib/display-path'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { cn } from '@/lib/utils'
import { copyFilePath, revealFile, toRelativePath } from '@/store/file-actions'
import { revealFileInTree } from '@/store/layout'
import { notifyError } from '@/store/notifications'
import { openPreview } from '@/store/preview'

// ~5 rows. A turn that rewrites twenty files should still read as one card in
// the transcript, not a wall the user has to scroll past to reach the composer.
const MAX_ROWS_HEIGHT = '9.375rem'

/**
 * Cursor-style "N files changed" summary closing out the newest assistant turn:
 * one row per file it edited with that file's +/-. A row click opens the file
 * in Hermes' editor/preview; the context menu exposes external open, reveal,
 * and copy actions.
 *
 * Wears the shared `WIDGET_SHELL_CLASS` so it reads as the same panel as the
 * transcript's other inline widgets rather than inventing its own chrome.
 */
export const ChangedFilesCard: FC<{ parts: readonly unknown[] }> = ({ parts }) => {
  const { t } = useI18n()
  const copy = t.assistant.thread
  const files = useMemo(() => deriveChangedFiles(parts), [parts])
  // File actions stay scoped to this transcript, including detached tiles.
  const view = useSessionView()
  const viewCwd = useStore(view.$cwd)

  if (files.length === 0) {
    return null
  }

  return (
    <div
      className={cn(WIDGET_SHELL_CLASS, 'mt-1.5 text-[length:var(--conversation-tool-font-size)]')}
      data-slot="aui_changed-files"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-(--ui-text-primary)">{copy.filesChanged(files.length)}</span>
      </div>
      <FadeScroll className="-mx-1.5 mt-1.5 flex flex-col px-1.5" maxHeight={MAX_ROWS_HEIGHT}>
        {files.map(file => (
          <ChangedFileRow file={file} key={file.path} viewCwd={viewCwd || null} />
        ))}
      </FadeScroll>
    </div>
  )
}

function isAbsolutePath(path: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(path)
}

function resolveActionPath(filePath: string, cwd: null | string): string {
  if (isAbsolutePath(filePath) || !cwd) {
    return filePath
  }

  return `${cwd.replace(/[\\/]+$/, '')}/${filePath.replace(/^\.?[\\/]/, '')}`
}

function ChangedFileRow({ file, viewCwd }: { file: ChangedFile; viewCwd: null | string }) {
  const { t } = useI18n()
  const actionPath = useMemo(() => resolveActionPath(file.path, viewCwd), [file.path, viewCwd])
  const actionLabel = displayPath(actionPath)

  const openInEditor = useCallback(() => {
    const anchor = defaultOpenPaneAnchor()

    void (async () => {
      try {
        const preview = await normalizeOrLocalPreviewTarget(file.path, viewCwd)

        if (preview) {
          openPreview(preview, 'file-browser', anchor)
        }
      } catch (error) {
        notifyError(error, t.rightSidebar.previewUnavailable)
      }
    })()
  }, [file.path, t.rightSidebar.previewUnavailable, viewCwd])

  return (
    <ChangedFileContextMenu
      actionPath={actionPath}
      onOpenFile={openInEditor}
      triggerLabel={actionLabel}
      viewCwd={viewCwd}
    >
      <button
        className="row-hover flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 text-left"
        onClick={openInEditor}
        type="button"
      >
        <FileTypeIcon className="shrink-0 text-(--ui-text-tertiary)" path={file.path} size="0.875rem" />
        <span className="min-w-0 flex-1 truncate text-(--ui-text-secondary)">{file.name}</span>
        <DiffCount added={file.added} removed={file.removed} />
      </button>
    </ChangedFileContextMenu>
  )
}

function ChangedFileContextMenu({
  actionPath,
  children,
  onOpenFile,
  triggerLabel,
  viewCwd
}: {
  actionPath: string
  children: ReactNode
  onOpenFile: () => void
  triggerLabel: string
  viewCwd: null | string
}) {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const m = t.fileMenu
  const localFs = !isDesktopFsRemoteMode()

  return (
    <ContextMenu>
      <Tip label={triggerLabel} side="top">
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      </Tip>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpenFile}>{c.openFile}</ContextMenuItem>
        {localFs && (
          <ContextMenuItem onSelect={() => void openDesktopPath(actionPath)}>{m.openOutside}</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => revealFileInTree(actionPath)}>{m.revealInSidebar}</ContextMenuItem>
        {localFs && (
          <ContextMenuItem onSelect={() => void revealFile(actionPath)}>{m.revealFileManager}</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyFilePath(actionPath)}>{m.copyPath}</ContextMenuItem>
        {viewCwd && (
          <ContextMenuItem onSelect={() => void copyFilePath(toRelativePath(actionPath, viewCwd))}>
            {m.copyRelativePath}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
