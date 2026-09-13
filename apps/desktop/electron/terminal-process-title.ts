import { execFileSync } from 'node:child_process'
import path from 'node:path'

interface ProcessRow {
  command: string
  pgid: number
  pid: number
  ppid: number
  stat: string
  tty: string
}

function parseProcessRows(output: string): ProcessRow[] {
  return output
    .trim()
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [pid, ppid, pgid, tty, stat, ...commandParts] = line.split(/\s+/)

      return {
        command: commandParts.join(' '),
        pgid: Number(pgid),
        pid: Number(pid),
        ppid: Number(ppid),
        stat: stat || '',
        tty: tty || ''
      }
    })
    .filter(row => Number.isFinite(row.pid) && Number.isFinite(row.ppid) && Number.isFinite(row.pgid) && row.command)
}

function processName(command: string): string | null {
  const name = path.basename(command.trim())

  return name && name !== '-' ? name : null
}

function isDescendantOf(row: ProcessRow, ownerPid: number, rowsByPid: Map<number, ProcessRow>): boolean {
  const seen = new Set<number>()
  let current: ProcessRow | undefined = row

  while (current && current.ppid > 0 && !seen.has(current.pid)) {
    if (current.ppid === ownerPid) {
      return true
    }

    seen.add(current.pid)
    current = rowsByPid.get(current.ppid)
  }

  return false
}

export function foregroundProcessNameFromPs(output: string, ownerPid: number): string | null {
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
    return null
  }

  const rows = parseProcessRows(output)
  const owner = rows.find(row => row.pid === ownerPid)

  if (!owner) {
    return null
  }

  const ownerName = processName(owner.command)

  if (!owner.tty || owner.tty === '?' || owner.tty === '??') {
    return ownerName
  }

  const rowsByPid = new Map(rows.map(row => [row.pid, row]))

  const candidates = rows.filter(
    row =>
      row.pid !== owner.pid &&
      row.tty === owner.tty &&
      row.stat.includes('+') &&
      isDescendantOf(row, owner.pid, rowsByPid)
  )

  if (!candidates.length) {
    return ownerName
  }

  const candidatePids = new Set(candidates.map(row => row.pid))
  const leaf = candidates.find(row => !candidates.some(other => other.ppid === row.pid && candidatePids.has(other.pid)))

  return processName((leaf ?? candidates[0]).command) ?? ownerName
}

export function readForegroundProcessName(ownerPid: number, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'win32' || !Number.isInteger(ownerPid) || ownerPid <= 0) {
    return null
  }

  try {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,tty=,stat=,comm='], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 2000
    })

    return foregroundProcessNameFromPs(output, ownerPid)
  } catch {
    return null
  }
}
