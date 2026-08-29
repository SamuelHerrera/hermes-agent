import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { isMain } from './utils.mjs'

export const CANONICAL_BUILD_BRANCH = 'main'

const DESKTOP_ROOT = resolve(import.meta.dirname, '..')
const REPO_ROOT = resolve(DESKTOP_ROOT, '..', '..')

function git(args, repoRoot = REPO_ROOT) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

export function validateBuildSource({
  branch,
  dirty,
  expectedBranch = CANONICAL_BUILD_BRANCH,
  head,
  upstreamHead,
  upstreamRef
}) {
  if (branch !== expectedBranch) {
    throw new Error(`Hermes Desktop must be built from ${expectedBranch}; current branch is ${branch || '(detached)'}.`)
  }

  if (dirty) {
    throw new Error('Hermes Desktop packaging working tree must be clean, including untracked files.')
  }

  if (!upstreamRef || !upstreamHead) {
    throw new Error(`${expectedBranch} must track a remote branch before packaging.`)
  }

  if (head !== upstreamHead) {
    throw new Error(`Local HEAD ${head} must exactly match ${upstreamRef} at ${upstreamHead}.`)
  }

  return { ok: true }
}

export function readBuildSource(repoRoot = REPO_ROOT, expectedBranch = CANONICAL_BUILD_BRANCH) {
  const branch = git(['branch', '--show-current'], repoRoot)
  const head = git(['rev-parse', 'HEAD'], repoRoot)
  const dirty = git(['status', '--porcelain'], repoRoot).length > 0
  const upstreamRef = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot)
  const remote = git(['config', `branch.${expectedBranch}.remote`], repoRoot)
  const mergeRef = git(['config', `branch.${expectedBranch}.merge`], repoRoot)

  if (!remote || !mergeRef) {
    return { branch, dirty, expectedBranch, head, upstreamHead: null, upstreamRef: null }
  }

  git(['fetch', '--quiet', remote, mergeRef], repoRoot)
  const upstreamHead = git(['rev-parse', 'FETCH_HEAD'], repoRoot)

  return { branch, dirty, expectedBranch, head, upstreamHead, upstreamRef }
}

function main() {
  try {
    const state = readBuildSource()
    validateBuildSource(state)
    console.log(
      `[assert-custom-build-source] verified ${state.branch} at ${state.head.slice(0, 12)} matches ${state.upstreamRef}`
    )
  } catch (error) {
    console.error(`[assert-custom-build-source] BLOCKED: ${error instanceof Error ? error.message : String(error)}`)
    console.error(
      'Commit and push every requested customization before packaging; review external patch backups first.'
    )
    process.exit(1)
  }
}

if (isMain(import.meta.url)) {
  main()
}
