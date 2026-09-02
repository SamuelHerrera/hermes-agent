import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const PROTOCOL_VERSION = 1 as const

export interface RuntimeConfig {
  origin: string
  socketPath: string
  statusPath: string
  token: string
  version: typeof PROTOCOL_VERSION
}

export interface RuntimeStatus {
  connected: boolean
  connectedAt?: string
  disconnectedAt?: string
  updatedAt: string
  version: typeof PROTOCOL_VERSION
}

const ORIGIN_PATTERN = /^chrome-extension:\/\/([a-p]{32})\/?$/

function normalizeOrigin(origin: string): string {
  const match = ORIGIN_PATTERN.exec(origin)

  if (match?.[1] === undefined) {throw new Error('invalid Chrome extension origin')}

  return `chrome-extension://${match[1]}/`
}

export function resolveHermesHome(
  cliHome?: string,
  environmentHome?: string,
  userHome: string = homedir()
): string {
  const configuredEnvironmentHome = arguments.length >= 2
    ? environmentHome
    : process.env.HERMES_HOME

  return resolve(cliHome ?? configuredEnvironmentHome ?? join(userHome, '.hermes'))
}

export function runtimeDirectoryFor(hermesHome: string): string {
  return join(resolve(hermesHome), 'chrome-bridge')
}

export async function ensurePrivateRuntimeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700, recursive: true })
  await chmod(directory, 0o700)
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, path)
    await chmod(path, 0o600)
  } finally {
    await unlink(temporaryPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
    })
  }
}

export async function readRuntimeConfig(path: string): Promise<RuntimeConfig> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<RuntimeConfig>

  if (
    parsed.version !== PROTOCOL_VERSION ||
    typeof parsed.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(parsed.token) ||
    typeof parsed.socketPath !== 'string' ||
    !isAbsolute(parsed.socketPath) ||
    typeof parsed.statusPath !== 'string' ||
    !isAbsolute(parsed.statusPath) ||
    typeof parsed.origin !== 'string'
  ) {
    throw new Error('invalid Hermes Chrome bridge runtime config')
  }

  return {
    origin: normalizeOrigin(parsed.origin),
    socketPath: parsed.socketPath,
    statusPath: parsed.statusPath,
    token: parsed.token,
    version: PROTOCOL_VERSION
  }
}

export async function writeRuntimeStatus(
  statusPath: string,
  status: RuntimeStatus
): Promise<void> {
  await writePrivateJson(statusPath, status)
}
