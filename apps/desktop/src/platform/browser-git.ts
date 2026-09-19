import type {
  HermesGitBaseBranch,
  HermesGitBranch,
  HermesGitWorktree,
  HermesPrComment,
  HermesRepoPullRequests,
  HermesRepoStatus,
  HermesReviewList,
  HermesReviewShipInfo
} from '@/global'

import type { HermesHost } from './types'

type GitBridge = NonNullable<NonNullable<Window['hermesDesktop']>['git']>
type Profile = () => string | undefined

function query(params: Record<string, boolean | null | string | undefined>): string {
  const value = new URLSearchParams()
  for (const [key, item] of Object.entries(params)) {
    if (item !== null && item !== undefined) value.set(key, String(item))
  }
  return value.toString()
}

export function createBrowserGit(host: HermesHost, profile: Profile): GitBridge {
  const get = <T>(route: string, params: Record<string, boolean | null | string | undefined>) =>
    host.api<T>({ path: `/api/git/${route}?${query(params)}`, profile: profile() })
  const post = <T>(route: string, body: Record<string, unknown>) =>
    host.api<T>({ body, method: 'POST', path: `/api/git/${route}`, profile: profile() })

  return {
    worktreeList: async repoPath => (await get<{ worktrees: HermesGitWorktree[] }>('worktrees', { path: repoPath })).worktrees,
    worktreeAdd: (repoPath, options) => post('worktree/add', { path: repoPath, ...options }),
    worktreeRemove: (repoPath, worktreePath, options) => post('worktree/remove', { force: options?.force ?? false, path: repoPath, worktreePath }),
    branchSwitch: (repoPath, branch) => post('branch/switch', { branch, path: repoPath }),
    branchList: async repoPath => (await get<{ branches: HermesGitBranch[] }>('branches', { path: repoPath })).branches,
    baseBranchList: async repoPath => (await get<{ branches: HermesGitBaseBranch[] }>('base-branches', { path: repoPath })).branches,
    repoStatus: repoPath => get<HermesRepoStatus | null>('status', { path: repoPath }),
    fileDiff: async (repoPath, filePath) => (await get<{ diff: string }>('file-diff', { path: repoPath, file: filePath })).diff,
    review: {
      list: (repoPath, scope, baseRef) => get<HermesReviewList>('review/list', { path: repoPath, scope, base: baseRef }),
      diff: async (repoPath, filePath, scope, baseRef, staged) =>
        (await get<{ diff: string }>('review/diff', { path: repoPath, file: filePath, scope, base: baseRef, staged })).diff,
      stage: (repoPath, filePath) => post('review/stage', { file: filePath ?? null, path: repoPath }),
      unstage: (repoPath, filePath) => post('review/unstage', { file: filePath ?? null, path: repoPath }),
      revert: (repoPath, filePath) => post('review/revert', { file: filePath ?? null, path: repoPath }),
      revParse: async (repoPath, ref) => (await get<{ sha: null | string }>('review/rev-parse', { path: repoPath, ref })).sha,
      commit: (repoPath, message, push) => post('review/commit', { message, path: repoPath, push }),
      commitContext: repoPath => get('review/commit-context', { path: repoPath }),
      push: repoPath => post('review/push', { path: repoPath }),
      shipInfo: repoPath => get<HermesReviewShipInfo>('review/ship-info', { path: repoPath }),
      prList: (repoPath, branches, numbers) => post<HermesRepoPullRequests>('review/pr-list', { branches, numbers: numbers ?? [], path: repoPath }),
      fetchPrComment: async (repoPath, url) =>
        (await post<{ comment: HermesPrComment | null }>('review/pr-comment', { path: repoPath, url })).comment,
      createPr: repoPath => post('review/create-pr', { path: repoPath })
    },
    scanRepos: async (roots, options) =>
      (await post<{ repos: { root: string; label: string }[] }>('scan', { roots, ...options })).repos
  }
}
