import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import type { HermesReadDirResult } from '@/global'
import { useI18n } from '@/i18n'

interface SudoFileFieldProps {
  disabled: boolean
  home: string
  profile: null | string
  value: string
  onChange: (value: string) => void
}

export function SudoFileField({ disabled, home, profile, value, onChange }: SudoFileFieldProps) {
  const { t } = useI18n()
  const copy = t.sudoSettings
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-2">
      <label className="grid gap-2 text-xs">
        {copy.path}
        <div className="flex min-w-0 gap-2">
          <Input aria-label={copy.path} disabled={disabled} onChange={e => onChange(e.target.value)} value={value} />
          <Button disabled={disabled} onClick={() => setOpen(true)} variant="secondary">
            {copy.browse}
          </Button>
        </div>
      </label>
      <p className="text-xs text-muted-foreground">{copy.fileHelp}</p>
      {open && (
        <BackendFilePicker
          home={home}
          onClose={() => setOpen(false)}
          onSelect={path => {
            onChange(path)
            setOpen(false)
          }}
          profile={profile}
        />
      )}
    </div>
  )
}

interface BackendFilePickerProps {
  home: string
  profile: null | string
  onSelect: (path: string) => void
  onClose: () => void
}

function BackendFilePicker({ home, profile, onSelect, onClose }: BackendFilePickerProps) {
  const { t } = useI18n()
  const copy = t.sudoSettings
  const [directory, setDirectory] = useState(home)
  const [draft, setDraft] = useState(home)
  const [result, setResult] = useState<HermesReadDirResult | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setResult(null)
    // Always use the credential owner's backend, even on a local Desktop.
    // Directory metadata only. Never open, upload, preview or read a secret.
    void window.hermesDesktop
      .api<HermesReadDirResult>({ path: `/api/fs/list?path=${encodeURIComponent(directory)}`, profile })
      .then(next => {
        if (alive) {
          setResult(next && Array.isArray(next.entries) ? next : { entries: [], error: 'unsupported' })
        }
      })
      .catch(() => {
        if (alive) {
          setResult({ entries: [], error: 'unavailable' })
        }
      })

    return () => {
      alive = false
    }
  }, [directory, profile, attempt])

  const go = (path: string) => {
    setDirectory(path)
    setDraft(path)
  }

  // Let the backend resolve .. for both POSIX and Windows paths.
  const separator = directory.includes('\\') ? '\\' : '/'

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) {
          onClose()
        }
      }}
      open
    >
      <DialogContent className="max-w-lg">
        <DialogTitle>{copy.browse}</DialogTitle>
        <DialogDescription>{copy.browseHelp}</DialogDescription>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault()

            if (draft.trim()) {
              go(draft.trim())
            }
          }}
        >
          <Input aria-label={copy.directory} onChange={e => setDraft(e.target.value)} value={draft} />
          <Button type="submit" variant="secondary">
            {copy.go}
          </Button>
        </form>
        <div className="max-h-64 min-h-32 overflow-auto">
          <Button onClick={() => go(directory + separator + '..')} size="sm" variant="text">
            <Codicon name="arrow-up" />
            {copy.parentFolder}
          </Button>
          {!result ? (
            <Loader />
          ) : result.error ? (
            <ErrorState title={copy.browseFailed}>
              <Button onClick={() => setAttempt(n => n + 1)} variant="secondary">
                {copy.retry}
              </Button>
            </ErrorState>
          ) : (
            <div className="grid gap-1">
              {result.entries.length === 0 && <p className="py-3 text-xs text-muted-foreground">{copy.emptyFolder}</p>}
              {result.entries.map(entry => (
                <button
                  className="row-hover flex min-w-0 items-center gap-2 rounded px-2 py-2 text-left text-xs"
                  key={entry.path}
                  onClick={() => (entry.isDirectory ? go(entry.path) : onSelect(entry.path))}
                  type="button"
                >
                  <Codicon name={entry.isDirectory ? 'folder' : 'file'} />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose} variant="text">
            {t.common.cancel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
