import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'vitest'

import { validateBuildSource } from './assert-custom-build-source.mjs'

const canonical = {
  branch: 'sam/local-customizations',
  dirty: false,
  expectedBranch: 'sam/local-customizations',
  head: 'a'.repeat(40),
  upstreamHead: 'a'.repeat(40),
  upstreamRef: 'samuel/sam/local-customizations'
}

test('accepts a clean canonical branch matching its remote tracking tip', () => {
  assert.deepEqual(validateBuildSource(canonical), { ok: true })
})

test('rejects packaging from a noncanonical branch', () => {
  assert.throws(
    () => validateBuildSource({ ...canonical, branch: 'main' }),
    /must be built from sam\/local-customizations/
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
    /must exactly match samuel\/sam\/local-customizations/
  )
})

test('the pack command runs the canonical-source guard before building', () => {
  const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'))

  assert.match(packageJson.scripts.pack, /^node scripts\/assert-custom-build-source\.mjs && npm run build/)
})
