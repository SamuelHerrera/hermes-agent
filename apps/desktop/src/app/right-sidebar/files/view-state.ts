import { desktopFsCacheKey } from '@/lib/desktop-fs'

interface ProjectTreeView {
  openState: Record<string, boolean>
  scrollTop: number
}

const STORAGE_KEY = 'hermes.desktop.files.folderViews.v1'
const MAX_FOLDERS = 50

export function projectTreeViewKey(cwd: string, connectionKey = desktopFsCacheKey()): string {
  return JSON.stringify([connectionKey, cwd])
}

function readViews(): Record<string, ProjectTreeView> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')

    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, ProjectTreeView>) : {}
  } catch {
    return {}
  }
}

export function readProjectTreeView(key: string): ProjectTreeView {
  const value = readViews()[key]

  return {
    openState:
      value?.openState && typeof value.openState === 'object'
        ? Object.fromEntries(Object.entries(value.openState).filter(([, open]) => typeof open === 'boolean'))
        : {},
    scrollTop: Number.isFinite(value?.scrollTop) ? Math.max(0, value.scrollTop) : 0
  }
}

export function saveProjectTreeView(key: string, patch: Partial<ProjectTreeView>) {
  const views = readViews()
  const next = { ...readProjectTreeView(key), ...patch }
  delete views[key]
  views[key] = next

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(views).slice(-MAX_FOLDERS))))
  } catch {
    // Unavailable/full storage must not prevent browsing the filesystem.
  }
}
