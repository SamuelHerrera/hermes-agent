import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  buildDetachRecords,
  canDetachBackendTopology,
  hasCompleteDetachCoverage,
  readDetachState,
  shouldKeepBackendAliveAfterParentExit,
  supportsBackendDetachLease,
  writeDetachState
} from './desktop-detach-state'

test('buildDetachRecords keeps only ready local backends with a pid and token', () => {
  const expiresAt = Date.now() + 60_000
  const records = buildDetachRecords([
    { role: 'primary', pid: 123, baseUrl: 'http://127.0.0.1:4567', token: 'tok', nonce: 'lease-1', expiresAt, profile: 'default' },
    { role: 'pool', pid: null, baseUrl: 'http://127.0.0.1:4568', token: 'tok2', nonce: 'lease-2', expiresAt, profile: 'worker' },
    { role: 'remote', pid: 456, baseUrl: 'https://remote.example', token: 'tok3', nonce: 'lease-3', expiresAt, profile: 'remote' },
    { role: 'primary', pid: 789, baseUrl: 'http://127.0.0.1:4569', token: 'tok4', nonce: '', expiresAt, profile: 'default' },
    { role: 'primary', pid: 790, baseUrl: 'http://127.0.0.1:4570', token: 'tok5', nonce: 'lease-5', expiresAt: Date.now() - 1, profile: 'default' }
  ])

  assert.deepEqual(records, [
    { role: 'primary', pid: 123, baseUrl: 'http://127.0.0.1:4567', token: 'tok', nonce: 'lease-1', expiresAt, profile: 'default' }
  ])
})

test('writeDetachState and readDetachState round trip records', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hermes-detach-'))
  const file = path.join(dir, 'detach.json')
  const expiresAt = Date.now() + 60_000

  try {
    writeDetachState(file, [
      { role: 'primary', pid: 123, baseUrl: 'http://127.0.0.1:4567', token: 'tok', nonce: 'lease-1', expiresAt, profile: 'default' }
    ])

    assert.ok(readFileSync(file, 'utf8').includes('http://127.0.0.1:4567'))
    assert.deepEqual(readDetachState(file), {
      version: 1,
      records: [{ role: 'primary', pid: 123, baseUrl: 'http://127.0.0.1:4567', token: 'tok', nonce: 'lease-1', expiresAt, profile: 'default' }]
    })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('readDetachState ignores malformed and non-local records', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hermes-detach-'))
  const file = path.join(dir, 'detach.json')
  const expiresAt = Date.now() + 60_000

  try {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        records: [
          { role: 'primary', pid: 123, baseUrl: 'http://127.0.0.1:4567', token: 'tok', nonce: 'lease-1', expiresAt },
          { role: 'primary', pid: 124, baseUrl: 'https://remote.example', token: 'tok2', nonce: 'lease-2', expiresAt },
          { role: 'primary', pid: 'bad', baseUrl: 'http://127.0.0.1:4569', token: 'tok3', nonce: 'lease-3', expiresAt }
        ]
      })
    )

    assert.deepEqual(readDetachState(file), {
      version: 1,
      records: [{ role: 'primary', pid: 123, baseUrl: 'http://127.0.0.1:4567', token: 'tok', nonce: 'lease-1', expiresAt, profile: null }]
    })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('hasCompleteDetachCoverage requires a lease for every Desktop-owned child', () => {
  assert.equal(hasCompleteDetachCoverage(2, 2), true)
  assert.equal(hasCompleteDetachCoverage(2, 1), false)
  assert.equal(hasCompleteDetachCoverage(0, 0), true)
})

test('canDetachBackendTopology never lets stale detached records cover current children', () => {
  assert.equal(canDetachBackendTopology({ childCount: 2, recordCount: 1, persistentPrimary: false, hasLiveDetached: true }), false)
  assert.equal(canDetachBackendTopology({ childCount: 2, recordCount: 2, persistentPrimary: false, hasLiveDetached: false }), true)
  assert.equal(canDetachBackendTopology({ childCount: 0, recordCount: 0, persistentPrimary: true, hasLiveDetached: false }), true)
  assert.equal(canDetachBackendTopology({ childCount: 0, recordCount: 0, persistentPrimary: false, hasLiveDetached: true }), true)
})

test('supportsBackendDetachLease requires an explicit live-backend capability', () => {
  assert.equal(supportsBackendDetachLease({ desktop_detach_lease_version: 1 }), true)
  assert.equal(supportsBackendDetachLease({ desktop_detach_lease_version: 0 }), false)
  assert.equal(supportsBackendDetachLease({}), false)
  assert.equal(supportsBackendDetachLease(null), false)
})

test('shouldKeepBackendAliveAfterParentExit only accepts an exact current pid lease', () => {
  const expiresAt = Date.now() + 60_000
  assert.equal(
    shouldKeepBackendAliveAfterParentExit(
      { version: 1, records: [{ role: 'primary', pid: 123, baseUrl: 'http://127.0.0.1:4567', token: 'tok', nonce: 'lease-1', expiresAt, profile: null }] },
      123
    ),
    true
  )
  assert.equal(
    shouldKeepBackendAliveAfterParentExit(
      { version: 1, records: [{ role: 'primary', pid: 123, baseUrl: 'http://127.0.0.1:4567', token: 'tok', nonce: 'lease-1', expiresAt, profile: null }] },
      999
    ),
    false
  )
  assert.equal(shouldKeepBackendAliveAfterParentExit(null, 123), false)
})
