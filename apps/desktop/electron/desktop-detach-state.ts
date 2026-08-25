import fs from 'node:fs'
import path from 'node:path'

export type DetachRecordRole = 'primary' | 'pool'

export interface DetachRecordInput {
  role: string
  pid?: number | null
  baseUrl?: string | null
  token?: string | null
  nonce?: string | null
  expiresAt?: number | null
  profile?: string | null
}

export interface DetachRecord {
  role: DetachRecordRole
  pid: number
  baseUrl: string
  token: string
  nonce: string
  expiresAt: number
  profile: string | null
}

export interface DetachState {
  version: 1
  records: DetachRecord[]
}

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function normalizeRecord(input: DetachRecordInput, now = Date.now()): DetachRecord | null {
  if (input.role !== 'primary' && input.role !== 'pool') {
    return null
  }
  if (!Number.isInteger(input.pid) || (input.pid as number) <= 0) {
    return null
  }
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
  const token = typeof input.token === 'string' ? input.token.trim() : ''
  const nonce = typeof input.nonce === 'string' ? input.nonce.trim() : ''
  const expiresAt = typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt) ? input.expiresAt : 0
  if (!baseUrl || !token || !nonce || expiresAt <= now || !isLoopbackHttpUrl(baseUrl)) {
    return null
  }
  const profile = typeof input.profile === 'string' && input.profile.trim() ? input.profile.trim() : null
  return { role: input.role, pid: input.pid as number, baseUrl, token, nonce, expiresAt, profile }
}

export function buildDetachRecords(inputs: DetachRecordInput[], now = Date.now()): DetachRecord[] {
  return inputs.map(input => normalizeRecord(input, now)).filter((record): record is DetachRecord => record !== null)
}

export function hasCompleteDetachCoverage(childCount: number, recordCount: number): boolean {
  return childCount === recordCount
}

export function canDetachBackendTopology({
  childCount,
  recordCount,
  persistentPrimary,
  hasLiveDetached
}: {
  childCount: number
  recordCount: number
  persistentPrimary: boolean
  hasLiveDetached: boolean
}): boolean {
  if (childCount > 0) {
    return hasCompleteDetachCoverage(childCount, recordCount)
  }
  return persistentPrimary || hasLiveDetached
}

export function supportsBackendDetachLease(status: unknown): boolean {
  return Number((status as any)?.desktop_detach_lease_version) >= 1
}

export function readDetachState(filePath: string): DetachState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const raw = parsed as { records?: unknown }
  if (!Array.isArray(raw.records)) {
    return null
  }
  const records = buildDetachRecords(raw.records as DetachRecordInput[])
  if (records.length < 1) {
    return null
  }
  return { version: 1, records }
}

export function writeDetachState(filePath: string, records: DetachRecordInput[]): DetachState {
  const state: DetachState = { version: 1, records: buildDetachRecords(records) }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    // Best effort on platforms/filesystems that do not support POSIX modes.
  }
  return state
}

export function shouldKeepBackendAliveAfterParentExit(state: DetachState | null, currentPid: number): boolean {
  if (!state || !Number.isInteger(currentPid) || currentPid <= 0) {
    return false
  }
  return state.records.some(record => record.pid === currentPid)
}
