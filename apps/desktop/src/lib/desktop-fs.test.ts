import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installHost, resetHostForTests } from '@/platform/host'
import type { HermesHost } from '@/platform/types'
import { $connection } from '@/store/session'

import {
  desktopDefaultCwd,
  desktopFileDiff,
  desktopFsCacheKey,
  desktopGitRoot,
  readDesktopDir,
  readDesktopFileDataUrl,
  readDesktopFileText,
  renameDesktopPath,
  selectBrowserFiles,
  selectDesktopPaths,
  setDesktopFsRemotePicker,
  trashDesktopPath,
  writeDesktopFileText
} from './desktop-fs'

const readDir = vi.fn(async () => ({ entries: [{ name: 'local', path: '/local', isDirectory: true }] }))
const readFileText = vi.fn(async () => ({ path: '/local/file.txt', text: 'local', byteSize: 5 }))
const readFileDataUrl = vi.fn(async () => 'data:text/plain;base64,bG9jYWw=')
const gitRoot = vi.fn(async () => '/local')
const selectPaths = vi.fn(async () => ['/local'])
const writeTextFile = vi.fn(async (path: string) => ({ path }))
const renamePath = vi.fn(async (_path: string, newName: string) => ({ path: `/local/${newName}` }))
const trashPath = vi.fn(async () => true)

const api = vi.fn(async ({ path }: { path: string }) => {
  if (path.startsWith('/api/fs/list?')) {
    return { entries: [{ name: 'remote', path: '/remote', isDirectory: true }] }
  }

  if (path.startsWith('/api/fs/read-text?')) {
    return { path: '/remote/file.txt', text: 'remote', byteSize: 6 }
  }

  if (path.startsWith('/api/fs/read-data-url?')) {
    return { dataUrl: 'data:text/plain;base64,cmVtb3Rl' }
  }

  if (path.startsWith('/api/fs/git-root?')) {
    return { root: '/remote' }
  }

  if (path === '/api/fs/default-cwd') {
    return { cwd: '/backend/project', branch: 'main' }
  }

  if (path.startsWith('/api/git/file-diff?')) {
    return { diff: 'remote diff' }
  }

  throw new Error(`unexpected path ${path}`)
})

function stubBridge() {
  vi.stubGlobal('window', {
    hermesDesktop: {
      api,
      gitRoot,
      readDir,
      readFileDataUrl,
      readFileText,
      renamePath,
      selectPaths,
      trashPath,
      writeTextFile
    }
  })
}

describe('desktop filesystem facade', () => {
  beforeEach(() => {
    stubBridge()
    $connection.set(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    $connection.set(null)
    setDesktopFsRemotePicker(null)
    resetHostForTests()
  })

  it('uses local Electron filesystem methods in local mode', async () => {
    $connection.set({ mode: 'local' } as never)

    await expect(readDesktopDir('/work')).resolves.toEqual({
      entries: [{ name: 'local', path: '/local', isDirectory: true }]
    })
    await expect(readDesktopFileText('/work/file.txt')).resolves.toMatchObject({ text: 'local' })
    await expect(readDesktopFileDataUrl('/work/file.txt')).resolves.toBe('data:text/plain;base64,bG9jYWw=')
    await expect(desktopGitRoot('/work')).resolves.toBe('/local')
    await expect(writeDesktopFileText('/work/file.txt', 'next')).resolves.toEqual({ path: '/work/file.txt' })
    await expect(renameDesktopPath('/work/file.txt', 'renamed.txt')).resolves.toBe('/local/renamed.txt')
    await expect(trashDesktopPath('/work/renamed.txt')).resolves.toBeUndefined()
    await expect(selectDesktopPaths({ directories: true })).resolves.toEqual(['/local'])

    expect(readDir).toHaveBeenCalledWith('/work')
    expect(readFileText).toHaveBeenCalledWith('/work/file.txt')
    expect(readFileDataUrl).toHaveBeenCalledWith('/work/file.txt')
    expect(gitRoot).toHaveBeenCalledWith('/work')
    expect(writeTextFile).toHaveBeenCalledWith('/work/file.txt', 'next')
    expect(renamePath).toHaveBeenCalledWith('/work/file.txt', 'renamed.txt')
    expect(trashPath).toHaveBeenCalledWith('/work/renamed.txt')
    expect(selectPaths).toHaveBeenCalledWith({ directories: true })
    expect(api).not.toHaveBeenCalled()
  })

  it('routes filesystem reads through authenticated backend REST in remote mode', async () => {
    $connection.set({ mode: 'remote' } as never)

    await expect(readDesktopDir('/home/user/project')).resolves.toMatchObject({ entries: [{ name: 'remote' }] })
    await expect(readDesktopFileText('/home/user/project/a b.txt')).resolves.toMatchObject({ text: 'remote' })
    await expect(readDesktopFileDataUrl('/home/user/project/a b.txt')).resolves.toBe('data:text/plain;base64,cmVtb3Rl')
    await expect(desktopGitRoot('/home/user/project')).resolves.toBe('/remote')
    await expect(desktopDefaultCwd()).resolves.toEqual({ cwd: '/backend/project', branch: 'main' })

    expect(api).toHaveBeenCalledWith({ path: '/api/fs/list?path=%2Fhome%2Fuser%2Fproject' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/read-text?path=%2Fhome%2Fuser%2Fproject%2Fa%20b.txt' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/read-data-url?path=%2Fhome%2Fuser%2Fproject%2Fa%20b.txt' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/git-root?path=%2Fhome%2Fuser%2Fproject' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/default-cwd' })
    expect(readDir).not.toHaveBeenCalled()
    expect(readFileText).not.toHaveBeenCalled()
    expect(readFileDataUrl).not.toHaveBeenCalled()
    expect(gitRoot).not.toHaveBeenCalled()
  })

  it('routes browser file operations through the installed host without an Electron bridge', async () => {
    const browserApi = vi.fn(async <T>({ path }: { path: string }): Promise<T> => {
      if (path.startsWith('/api/fs/list?')) {
        return { entries: [] } as T
      }

      if (path.startsWith('/api/fs/read-text?')) {
        return { path: '/srv/a.txt', text: 'browser', byteSize: 7 } as T
      }

      if (path.startsWith('/api/fs/read-data-url?')) {
        return { dataUrl: 'data:text/plain;base64,eA==' } as T
      }

      if (path.startsWith('/api/fs/git-root?')) {
        return { root: '/srv' } as T
      }

      if (path === '/api/fs/default-cwd') {
        return { cwd: '/srv', branch: 'main' } as T
      }

      if (path === '/api/fs/write-text') {
        return { path: '/srv/a.txt' } as T
      }

      if (path === '/api/fs/rename') {
        return { path: '/srv/b.txt' } as T
      }

      if (path === '/api/fs/trash') {
        return { ok: true } as T
      }

      throw new Error(`unexpected path ${path}`)
    })

    installHost({
      kind: 'browser',
      capabilities: {} as HermesHost['capabilities'],
      api: browserApi as HermesHost['api'],
      getConnection: vi.fn(),
      getGatewayWsUrl: vi.fn()
    })
    vi.stubGlobal('window', {})
    $connection.set({ mode: 'local', profile: 'browser-profile' } as never)

    await expect(readDesktopDir('/srv')).resolves.toEqual({ entries: [] })
    await expect(readDesktopFileText('/srv/a.txt')).resolves.toMatchObject({ text: 'browser' })
    await expect(readDesktopFileDataUrl('/srv/a.txt')).resolves.toBe('data:text/plain;base64,eA==')
    await expect(desktopGitRoot('/srv/a.txt')).resolves.toBe('/srv')
    await expect(desktopDefaultCwd()).resolves.toEqual({ cwd: '/srv', branch: 'main' })
    await expect(writeDesktopFileText('/srv/a.txt', 'next')).resolves.toEqual({ path: '/srv/a.txt' })
    await expect(renameDesktopPath('/srv/a.txt', 'b.txt')).resolves.toBe('/srv/b.txt')
    await expect(trashDesktopPath('/srv/b.txt')).resolves.toBeUndefined()

    expect(browserApi).toHaveBeenCalledWith({ path: '/api/fs/list?path=%2Fsrv', profile: 'browser-profile' })
    expect(browserApi).toHaveBeenCalledWith({
      body: { content: 'next', path: '/srv/a.txt' },
      method: 'POST',
      path: '/api/fs/write-text',
      profile: 'browser-profile'
    })
    expect(browserApi).toHaveBeenCalledWith({
      body: { newName: 'b.txt', path: '/srv/a.txt' },
      method: 'POST',
      path: '/api/fs/rename',
      profile: 'browser-profile'
    })
    expect(browserApi).toHaveBeenCalledWith({
      body: { path: '/srv/b.txt' },
      method: 'POST',
      path: '/api/fs/trash',
      profile: 'browser-profile'
    })
  })

  it('fails browser git file diffs closed until the browser git scope ships', async () => {
    installHost({
      kind: 'browser',
      capabilities: {} as HermesHost['capabilities'],
      api: vi.fn() as HermesHost['api'],
      getConnection: vi.fn(),
      getGatewayWsUrl: vi.fn()
    })
    vi.stubGlobal('window', {})

    await expect(desktopFileDiff('/repo', 'src/a.ts')).rejects.toThrow(/not available in the browser/i)
  })

  it('returns browser-selected File objects without fabricating filesystem paths', async () => {
    const selected = new File(['bytes'], 'notes.txt', { type: 'text/plain' })
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { configurable: true, value: [selected] })
      this.dispatchEvent(new Event('change'))
    })

    await expect(selectBrowserFiles({ filters: [{ name: 'Text', extensions: ['txt'] }] })).resolves.toEqual([selected])
    expect(click).toHaveBeenCalledOnce()
  })

  it('targets the active profile backend so a remote profile never reads local disk', async () => {
    $connection.set({ mode: 'remote', profile: 'remote-docker' } as never)

    await readDesktopDir('/srv/project')
    await desktopDefaultCwd()

    expect(api).toHaveBeenCalledWith({ path: '/api/fs/list?path=%2Fsrv%2Fproject', profile: 'remote-docker' })
    expect(api).toHaveBeenCalledWith({ path: '/api/fs/default-cwd', profile: 'remote-docker' })
  })

  it('keys SSH filesystem caches by stable host identity instead of the forwarded port', () => {
    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'operator@remote-box',
      baseUrl: 'http://127.0.0.1:41001'
    } as never)
    const first = desktopFsCacheKey()

    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'operator@remote-box',
      baseUrl: 'http://127.0.0.1:52002'
    } as never)

    expect(desktopFsCacheKey()).toBe(first)
    expect(first).toContain('operator@remote-box')
    expect(first).not.toContain('41001')
  })

  it('separates SSH filesystem caches by ownership and profile', () => {
    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'host-a',
      remoteIdentity: 'owner-a',
      profile: 'one'
    } as never)
    const first = desktopFsCacheKey()
    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'host-a',
      remoteIdentity: 'owner-b',
      profile: 'one'
    } as never)
    const otherOwner = desktopFsCacheKey()
    $connection.set({
      mode: 'remote',
      remoteKind: 'ssh',
      remoteHost: 'host-a',
      remoteIdentity: 'owner-a',
      profile: 'two'
    } as never)

    expect(otherOwner).not.toBe(first)
    expect(desktopFsCacheKey()).not.toBe(first)
  })

  it('routes file diffs through backend git in remote mode', async () => {
    $connection.set({ mode: 'remote' } as never)

    await expect(desktopFileDiff('/repo', 'src/a b.ts')).resolves.toBe('remote diff')
    expect(api).toHaveBeenCalledWith({ path: '/api/git/file-diff?path=%2Frepo&file=src%2Fa%20b.ts' })
  })

  it('uses the registered in-app directory picker in remote mode', async () => {
    const remoteSelect = vi.fn(async () => ['/remote/project'])
    $connection.set({ mode: 'remote' } as never)
    setDesktopFsRemotePicker({ selectPaths: remoteSelect })

    await expect(selectDesktopPaths({ defaultPath: '/remote', directories: true, multiple: false })).resolves.toEqual([
      '/remote/project'
    ])

    expect(remoteSelect).toHaveBeenCalledWith({ defaultPath: '/remote', directories: true, multiple: false })
    expect(selectPaths).not.toHaveBeenCalled()
  })

  it('uses the local Electron picker for remote file selection', async () => {
    const remoteSelect = vi.fn(async () => ['/remote/project'])
    $connection.set({ mode: 'remote' } as never)
    setDesktopFsRemotePicker({ selectPaths: remoteSelect })

    await expect(selectDesktopPaths({ directories: false, multiple: false })).resolves.toEqual(['/local'])

    expect(selectPaths).toHaveBeenCalledWith({ directories: false, multiple: false })
    expect(remoteSelect).not.toHaveBeenCalled()
  })

  it('limits the remote picker to single-directory selection', async () => {
    const remoteSelect = vi.fn(async () => ['/remote/project'])
    $connection.set({ mode: 'remote' } as never)
    setDesktopFsRemotePicker({ selectPaths: remoteSelect })

    await expect(selectDesktopPaths({ directories: true })).resolves.toEqual(['/remote/project'])

    expect(remoteSelect).toHaveBeenCalledWith({ directories: true, multiple: false })
    expect(selectPaths).not.toHaveBeenCalled()
  })
})
