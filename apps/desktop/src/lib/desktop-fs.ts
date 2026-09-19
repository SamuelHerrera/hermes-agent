import type {
  HermesConnection,
  HermesReadDirResult,
  HermesReadFileTextResult,
  HermesSelectPathsOptions
} from '@/global'
import { tryResolveHost } from '@/platform/host'
import { hostApi } from '@/platform/host-api'
import { $connection } from '@/store/session'

export interface DesktopFsRemotePicker {
  selectPaths: (options?: HermesSelectPathsOptions) => Promise<string[]>
}

let remotePicker: DesktopFsRemotePicker | null = null

export function setDesktopFsRemotePicker(next: DesktopFsRemotePicker | null) {
  remotePicker = next
}

function connectionCacheKey(connection: HermesConnection | null) {
  if (!connection) {
    return 'local:'
  }

  const target =
    connection.remoteKind === 'ssh'
      ? connection.remoteIdentity || connection.remoteHost || ''
      : connection.baseUrl || ''

  return `${connection.mode || 'local'}:${connection.remoteKind || ''}:${connection.profile || ''}:${target}`
}

export function desktopFsCacheKey(connection: HermesConnection | null = $connection.get()) {
  return connectionCacheKey(connection)
}

export function isDesktopFsRemoteMode() {
  return tryResolveHost()?.kind === 'browser' || $connection.get()?.mode === 'remote'
}

function isBrowserHost() {
  return tryResolveHost()?.kind === 'browser'
}

// Active profile for FS/git REST calls. Without it the Electron api bridge
// hits the primary (local) backend even when the user switched to a remote profile.
export function desktopFsProfile(): string | undefined {
  return $connection.get()?.profile || undefined
}

function fsPath(endpoint: string, filePath: string) {
  return `/api/fs/${endpoint}?path=${encodeURIComponent(filePath)}`
}

function bridge() {
  const desktop = window.hermesDesktop

  if (!desktop) {
    throw new Error('Hermes Desktop bridge is unavailable')
  }

  return desktop
}

function pathToFileUrl(path: string): string {
  const isWindowsUnc = path.startsWith('\\\\')
  const normalized = isWindowsUnc || /^[a-z]:[\\/]/i.test(path) ? path.replace(/\\/g, '/') : path

  const encoded = normalized
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')

  if (isWindowsUnc) {
    return `file://${encoded.slice(2)}`
  }

  return `file://${encoded.startsWith('/') ? encoded : `/${encoded}`}`
}

function remoteFsApi<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return hostApi<T>(
    body ? { body, method: 'POST', path, profile: desktopFsProfile() } : { path, profile: desktopFsProfile() }
  )
}

export async function readDesktopDir(path: string): Promise<HermesReadDirResult> {
  if (!isDesktopFsRemoteMode()) {
    return bridge().readDir(path)
  }

  return remoteFsApi<HermesReadDirResult>(fsPath('list', path))
}

export async function readDesktopFileText(path: string): Promise<HermesReadFileTextResult> {
  if (!isDesktopFsRemoteMode()) {
    return bridge().readFileText(path)
  }

  return remoteFsApi<HermesReadFileTextResult>(fsPath('read-text', path))
}

// Save UTF-8 text back to a file. Local writes go through the hardened Electron
// IPC; remote writes hit the dashboard's POST /api/fs/write-text (same path
// hardening, parent-must-exist, size cap) so the editor behaves identically in
// both modes. Stale-on-disk detection is the caller's job (re-read before save).
export async function writeDesktopFileText(path: string, content: string): Promise<{ path: string }> {
  if (!isDesktopFsRemoteMode()) {
    const desktop = bridge()

    if (!desktop.writeTextFile) {
      throw new Error('Saving is not available')
    }

    return desktop.writeTextFile(path, content)
  }

  const result = await remoteFsApi<{ ok?: boolean; path?: string }>('/api/fs/write-text', { content, path })

  return { path: result.path || path }
}

export async function readDesktopFileDataUrl(path: string): Promise<string> {
  if (!isDesktopFsRemoteMode()) {
    return bridge().readFileDataUrl(path)
  }

  const result = await remoteFsApi<string | { dataUrl?: string }>(fsPath('read-data-url', path))

  return typeof result === 'string' ? result : result.dataUrl || ''
}

export async function desktopGitRoot(path: string): Promise<string | null> {
  if (!isDesktopFsRemoteMode()) {
    const desktop = bridge()

    return desktop.gitRoot ? desktop.gitRoot(path) : null
  }

  return (await remoteFsApi<{ root: string | null }>(fsPath('git-root', path))).root
}

export async function desktopDefaultCwd(): Promise<{ branch: string; cwd: string } | null> {
  if (!isDesktopFsRemoteMode()) {
    return null
  }

  return remoteFsApi<{ branch: string; cwd: string }>('/api/fs/default-cwd')
}

// Reveal a path in the OS file manager (Finder / Explorer / Files). Local only.
export async function revealDesktopPath(path: string): Promise<void> {
  await bridge().revealPath?.(path)
}

// Open a local file with the OS default application. Remote backend paths are
// not valid on the Desktop machine, so callers should gate this to local mode.
export async function openDesktopPath(path: string): Promise<void> {
  if (isDesktopFsRemoteMode()) {
    throw new Error('Opening files outside Hermes is only available for local files')
  }

  await bridge().openExternal(pathToFileUrl(path))
}

// Rename a file/folder in place on the host that owns the active workspace.
export async function renameDesktopPath(path: string, newName: string): Promise<string> {
  if (isDesktopFsRemoteMode()) {
    const result = await remoteFsApi<{ path: string }>('/api/fs/rename', { newName, path })

    return result.path
  }

  const desktop = bridge()

  if (!desktop.renamePath) {
    throw new Error('Rename is not available')
  }

  const result = await desktop.renamePath(path, newName)

  return result.path
}

// Move a file/folder to the owning host's OS trash (recoverable).
export async function trashDesktopPath(path: string): Promise<void> {
  if (isDesktopFsRemoteMode()) {
    await remoteFsApi('/api/fs/trash', { path })

    return
  }

  const desktop = bridge()

  if (!desktop.trashPath) {
    throw new Error('Delete is not available')
  }

  await desktop.trashPath(path)
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await bridge().writeClipboard(text)
}

// Working-tree-vs-HEAD diff for one file. Empty when unchanged / not a repo.
// Remote gateway → backend git (/api/git/file-diff); local → Electron git.
export async function desktopFileDiff(repoRoot: string, filePath: string): Promise<string> {
  if (isBrowserHost()) {
    throw new Error('Git file diffs are not available in the browser yet')
  }

  if (isDesktopFsRemoteMode()) {
    const result = await remoteFsApi<{ diff: string }>(
      `/api/git/file-diff?path=${encodeURIComponent(repoRoot)}&file=${encodeURIComponent(filePath)}`
    )

    return result.diff || ''
  }

  const git = bridge().git

  return git?.fileDiff ? git.fileDiff(repoRoot, filePath) : ''
}

/** Open the browser's native file chooser and return the actual File handles.
 * Browser files intentionally have no filesystem path; callers must retain or
 * upload their bytes instead of inventing a local/backend path. */
export function selectBrowserFiles(options: HermesSelectPathsOptions = {}): Promise<File[]> {
  if (options.directories) {
    return Promise.resolve([])
  }

  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = options.multiple !== false

    const extensions = options.filters?.flatMap(filter => filter.extensions) ?? []
    if (extensions.length) {
      input.accept = extensions.map(extension => `.${extension.replace(/^\./, '')}`).join(',')
    }

    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true })
    input.click()
  })
}

export async function selectDesktopPaths(options?: HermesSelectPathsOptions): Promise<string[]> {
  if (isBrowserHost()) {
    if (!options?.directories) {
      throw new Error('Browser file selection cannot provide backend filesystem paths')
    }

    return remotePicker ? remotePicker.selectPaths({ ...options, multiple: false }) : []
  }

  if (!isDesktopFsRemoteMode()) {
    return bridge().selectPaths(options)
  }

  if (!options?.directories) {
    return bridge().selectPaths(options)
  }

  return remotePicker ? remotePicker.selectPaths({ ...options, multiple: false }) : []
}
