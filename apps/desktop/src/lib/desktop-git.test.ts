import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installHost, resetHostForTests } from '@/platform/host'
import type { HermesHost } from '@/platform/types'
import { $connection } from '@/store/session'

import { desktopGit } from './desktop-git'

const api = vi.fn(async ({ path }: { path: string }) => {
  if (path.startsWith('/api/git/worktrees')) return { worktrees: [{ path: '/srv/r' }] }
  if (path.startsWith('/api/git/branches')) return { branches: [{ name: 'main' }] }
  if (path.startsWith('/api/git/base-branches')) return { branches: [{ name: 'origin/main' }] }
  if (path.startsWith('/api/git/file-diff') || path.startsWith('/api/git/review/diff')) return { diff: 'diff' }
  if (path.startsWith('/api/git/review/rev-parse')) return { sha: 'abc' }
  if (path.startsWith('/api/git/scan')) return { repos: [{ root: '/srv/r', label: 'r' }] }
  if (path.startsWith('/api/git/review/pr-comment')) return { comment: { author: 'sam' } }
  return { ok: true }
})

const capabilities = {
  backendFiles: true,
  backendGit: true,
  backendLifecycle: false,
  browserClipboard: true,
  browserMicrophone: true,
  browserNotifications: true,
  deepLinkProtocol: false,
  globalHotkeys: false,
  nativeDialogs: false,
  nativeWindows: false,
  persistentTerminal: false,
  revealHostPath: false,
  screenWakeLock: true,
  windowBelow: false
}

function browserHost(): HermesHost {
  return {
    kind: 'browser',
    capabilities,
    api: api as HermesHost['api'],
    getConnection: vi.fn(),
    getGatewayWsUrl: vi.fn()
  }
}

describe('desktop git facade', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
    $connection.set({ mode: 'remote', profile: 'backend-b' } as never)
    installHost(browserHost())
  })

  afterEach(() => {
    resetHostForTests()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    $connection.set(null)
  })

  it('uses Electron git locally', async () => {
    const repoStatus = vi.fn(async () => ({ branch: 'main' }))
    vi.stubGlobal('window', { hermesDesktop: { git: { repoStatus } } })
    resetHostForTests()
    $connection.set({ mode: 'local' } as never)

    await expect(desktopGit()?.repoStatus('/work')).resolves.toEqual({ branch: 'main' })
    expect(repoStatus).toHaveBeenCalledWith('/work')
    expect(api).not.toHaveBeenCalled()
  })

  it('fails closed instead of falling back to Electron-local Git when browser capability is absent', () => {
    installHost({ ...browserHost(), capabilities: { ...capabilities, backendGit: false } })
    vi.stubGlobal('window', { hermesDesktop: { git: { repoStatus: vi.fn() } } })

    expect(desktopGit()).toBeUndefined()
  })

  it.each([
    ['worktreeList', (git: any) => git.worktreeList('/srv/r'), { path: '/api/git/worktrees?path=%2Fsrv%2Fr', profile: 'backend-b' }],
    ['worktreeAdd', (git: any) => git.worktreeAdd('/srv/r', { branch: 'feat' }), { body: { path: '/srv/r', branch: 'feat' }, method: 'POST', path: '/api/git/worktree/add', profile: 'backend-b' }],
    ['worktreeRemove', (git: any) => git.worktreeRemove('/srv/r', '/srv/w', { force: true }), { body: { force: true, path: '/srv/r', worktreePath: '/srv/w' }, method: 'POST', path: '/api/git/worktree/remove', profile: 'backend-b' }],
    ['branchSwitch', (git: any) => git.branchSwitch('/srv/r', 'feat'), { body: { branch: 'feat', path: '/srv/r' }, method: 'POST', path: '/api/git/branch/switch', profile: 'backend-b' }],
    ['branchList', (git: any) => git.branchList('/srv/r'), { path: '/api/git/branches?path=%2Fsrv%2Fr', profile: 'backend-b' }],
    ['baseBranchList', (git: any) => git.baseBranchList('/srv/r'), { path: '/api/git/base-branches?path=%2Fsrv%2Fr', profile: 'backend-b' }],
    ['repoStatus', (git: any) => git.repoStatus('/srv/r'), { path: '/api/git/status?path=%2Fsrv%2Fr', profile: 'backend-b' }],
    ['fileDiff', (git: any) => git.fileDiff('/srv/r', 'a b.txt'), { path: '/api/git/file-diff?path=%2Fsrv%2Fr&file=a+b.txt', profile: 'backend-b' }],
    ['review.list', (git: any) => git.review.list('/srv/r', 'branch', 'base'), { path: '/api/git/review/list?path=%2Fsrv%2Fr&scope=branch&base=base', profile: 'backend-b' }],
    ['review.diff', (git: any) => git.review.diff('/srv/r', 'a', 'uncommitted', null, true), { path: '/api/git/review/diff?path=%2Fsrv%2Fr&file=a&scope=uncommitted&staged=true', profile: 'backend-b' }],
    ['review.stage', (git: any) => git.review.stage('/srv/r', 'a'), { body: { file: 'a', path: '/srv/r' }, method: 'POST', path: '/api/git/review/stage', profile: 'backend-b' }],
    ['review.unstage', (git: any) => git.review.unstage('/srv/r', 'a'), { body: { file: 'a', path: '/srv/r' }, method: 'POST', path: '/api/git/review/unstage', profile: 'backend-b' }],
    ['review.revert', (git: any) => git.review.revert('/srv/r', 'a'), { body: { file: 'a', path: '/srv/r' }, method: 'POST', path: '/api/git/review/revert', profile: 'backend-b' }],
    ['review.revParse', (git: any) => git.review.revParse('/srv/r', 'HEAD'), { path: '/api/git/review/rev-parse?path=%2Fsrv%2Fr&ref=HEAD', profile: 'backend-b' }],
    ['review.commit', (git: any) => git.review.commit('/srv/r', 'msg', false), { body: { message: 'msg', path: '/srv/r', push: false }, method: 'POST', path: '/api/git/review/commit', profile: 'backend-b' }],
    ['review.commitContext', (git: any) => git.review.commitContext('/srv/r'), { path: '/api/git/review/commit-context?path=%2Fsrv%2Fr', profile: 'backend-b' }],
    ['review.push', (git: any) => git.review.push('/srv/r'), { body: { path: '/srv/r' }, method: 'POST', path: '/api/git/review/push', profile: 'backend-b' }],
    ['review.shipInfo', (git: any) => git.review.shipInfo('/srv/r'), { path: '/api/git/review/ship-info?path=%2Fsrv%2Fr', profile: 'backend-b' }],
    ['review.prList', (git: any) => git.review.prList('/srv/r', ['feat'], [3]), { body: { branches: ['feat'], numbers: [3], path: '/srv/r' }, method: 'POST', path: '/api/git/review/pr-list', profile: 'backend-b' }],
    ['review.fetchPrComment', (git: any) => git.review.fetchPrComment('/srv/r', 'https://github.com/o/r/pull/1#issuecomment-2'), { body: { path: '/srv/r', url: 'https://github.com/o/r/pull/1#issuecomment-2' }, method: 'POST', path: '/api/git/review/pr-comment', profile: 'backend-b' }],
    ['review.createPr', (git: any) => git.review.createPr('/srv/r'), { body: { path: '/srv/r' }, method: 'POST', path: '/api/git/review/create-pr', profile: 'backend-b' }],
    ['scanRepos', (git: any) => git.scanRepos(['/srv'], { maxDepth: 2, enabled: true, excludePaths: ['/srv/vendor'] }), { body: { roots: ['/srv'], maxDepth: 2, enabled: true, excludePaths: ['/srv/vendor'] }, method: 'POST', path: '/api/git/scan', profile: 'backend-b' }]
  ])('routes %s through the installed backend B host', async (_name, invoke, expected) => {
    await invoke(desktopGit())
    expect(api).toHaveBeenLastCalledWith(expected)
  })
})
