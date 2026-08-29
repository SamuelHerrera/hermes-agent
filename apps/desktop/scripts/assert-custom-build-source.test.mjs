import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'vitest'

import { validateBuildSource } from './assert-custom-build-source.mjs'

const canonical = {
  branch: 'main',
  dirty: false,
  expectedBranch: 'main',
  head: 'a'.repeat(40),
  upstreamHead: 'a'.repeat(40),
  upstreamRef: 'samuel/main'
}

test('accepts a clean canonical branch matching its remote tracking tip', () => {
  assert.deepEqual(validateBuildSource(canonical), { ok: true })
})

test('rejects packaging from a noncanonical branch', () => {
  assert.throws(
    () => validateBuildSource({ ...canonical, branch: 'feature' }),
    /must be built from main/
  )
})

test('rejects packaging with tracked or untracked working-tree changes', () => {
  assert.throws(() => validateBuildSource({ ...canonical, dirty: true }), /working tree must be clean/)
})

test('rejects a canonical branch without a remote tracking ref', () => {
  assert.throws(
    () => validateBuildSource({ ...canonical, upstreamHead: null, upstreamRef: null }),
    /must track a remote branch/
  )
})

test('rejects a canonical branch whose HEAD does not match its remote tip', () => {
  assert.throws(
    () => validateBuildSource({ ...canonical, upstreamHead: 'b'.repeat(40) }),
    /must exactly match samuel\/main/
  )
})

test('the pack command runs the canonical-source guard before building', () => {
  const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'))

  assert.match(packageJson.scripts.pack, /^node scripts\/assert-custom-build-source\.mjs && npm run build/)
})
