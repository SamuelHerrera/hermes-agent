import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import {
  $projectDialog,
  addProjectFolder,
  closeProjectDialog,
  createProject,
  pickProjectFolder,
  renameProject
} from '@/store/projects'

import { RecentProjects } from './recent-projects'

// Single dialog mounted in the shell; it renders create / rename /
// add-folder flows driven by the $projectDialog atom. Folders are chosen via
// the native directory picker (reused from the default-project-dir setting).
export function ProjectDialog() {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const state = useStore($projectDialog)
  const open = state !== null
  const mode = state?.mode ?? 'create'

  const [name, setName] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName(state?.name ?? '')
      setFolders([])
      setSubmitting(false)

      if (mode !== 'add-folder') {
        window.setTimeout(() => nameRef.current?.select(), 0)
      }
    }
  }, [open, mode, state?.name])

  const onOpenChange = (next: boolean) => {
    if (!next) {
      closeProjectDialog()
    }
  }

  // One submit beat for every flow: guard re-entry, run the write, close on
  // success, surface a toast on failure. Callers pass only the write.
  const runSubmit = async (write: () => Promise<unknown>) => {
    if (submitting) {
      return
    }

    setSubmitting(true)

    try {
      await write()
      closeProjectDialog()
    } catch (err) {
      notifyError(err, p.createFailed)
    } finally {
      setSubmitting(false)
    }
  }

  const pickFolder = async () => {
    try {
      const dir = await pickProjectFolder()

      if (!dir) {
        return
      }

      const projectId = state?.projectId

      if (mode === 'add-folder' && projectId) {
        await runSubmit(() => addProjectFolder(projectId, dir))

        return
      }

      setFolders(prev => (prev.includes(dir) ? prev : [...prev, dir]))
    } catch (err) {
      notifyError(err, p.createFailed)
    }
  }

  const submit = async () => {
    const trimmed = name.trim()
    const projectId = state?.projectId

    if (mode === 'rename' && projectId) {
      if (trimmed) {
        await runSubmit(() => renameProject(projectId, trimmed))
      }

      return
    }

    // A project owns sessions by folder (cwd-prefix), so creation requires at
    // least one — a folder-less project couldn't hold a session anyway.
    if (mode === 'create' && trimmed && folders.length) {
      await runSubmit(() => createProject({ folders, name: trimmed, use: true }))
    }
  }

  const title = mode === 'rename' ? p.renameTitle : mode === 'add-folder' ? p.addFolderTitle : p.createTitle

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        bodyClassName="grid-cols-1"
        className="w-[calc(100vw-2rem)] max-w-md min-[800px]:has-[[data-project-recents]]:max-w-3xl"
        onInteractOutside={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {mode === 'create' && <DialogDescription>{p.createDesc}</DialogDescription>}
        </DialogHeader>

        <div className="grid min-w-0 grid-cols-1 gap-4 min-[800px]:has-[[data-project-recents]]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="grid min-w-0 grid-cols-1 content-start gap-3">
            {mode !== 'add-folder' && (
              <Input
                autoFocus
                disabled={submitting}
                onChange={event => setName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submit()
                  } else if (event.key === 'Escape') {
                    onOpenChange(false)
                  }
                }}
                placeholder={p.namePlaceholder}
                ref={nameRef}
                value={name}
              />
            )}

            {mode === 'create' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{p.foldersLabel}</span>
                {folders.length === 0 ? (
                  <span className="text-[0.75rem] text-(--ui-text-quaternary)">{p.noFolders}</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {folders.map((folder, index) => (
                      <li
                        className={cn(
                          'flex items-center gap-2 rounded-md bg-(--ui-control-hover-background) px-2 py-1 text-[0.75rem]'
                        )}
                        key={folder}
                      >
                        <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="folder" size="0.75rem" />
                        <span className="min-w-0 flex-1 truncate" title={folder}>
                          {folder}
                        </span>
                        {index === 0 && (
                          <span className="shrink-0 text-[0.625rem] uppercase text-(--ui-text-quaternary)">
                            {p.primaryBadge}
                          </span>
                        )}
                        <Tip label={p.removeFolder}>
                          <Button
                            aria-label={p.removeFolder}
                            className="size-5 shrink-0 text-(--ui-text-quaternary) hover:text-foreground"
                            onClick={() => setFolders(prev => prev.filter(f => f !== folder))}
                            size="icon-xs"
                            type="button"
                            variant="ghost"
                          >
                            <Codicon name="close" size="0.75rem" />
                          </Button>
                        </Tip>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  className="self-start"
                  disabled={submitting}
                  onClick={() => void pickFolder()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Codicon name="add" size="0.75rem" />
                  {p.addFolder}
                </Button>
              </div>
            )}

            {mode === 'add-folder' && (
              <Button disabled={submitting} onClick={() => void pickFolder()} type="button">
                <Codicon name="folder-opened" size="0.875rem" />
                {p.addFolder}
              </Button>
            )}
          </div>
          {mode === 'create' && open && (
            <RecentProjects disabled={submitting} onBusyChange={setSubmitting} onOpen={closeProjectDialog} />
          )}
        </div>

        {mode !== 'add-folder' && (
          <DialogFooter>
            <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button
              disabled={submitting || !name.trim() || (mode === 'create' && folders.length === 0)}
              onClick={() => void submit()}
              type="button"
            >
              {mode === 'rename' ? t.common.save : p.create}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
