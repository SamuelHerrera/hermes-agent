import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, win32 } from 'node:path'
import { promisify } from 'node:util'

const PROTOCOL_VERSION = 1 as const

export interface RuntimeConfig {
  clientTokens?: Record<string, string>
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

export function brokerSocketPathFor(hermesHome: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    const identity = createHash('sha256').update(win32.resolve(hermesHome).toLowerCase()).digest('hex').slice(0, 32)

    return `\\\\.\\pipe\\hermes-chrome-bridge-${identity}`
  }

  return join(runtimeDirectoryFor(hermesHome), 'broker.sock')
}

export function isLocalBrokerSocketPath(path: string, platform: NodeJS.Platform = process.platform): boolean {
  const prefix = '\\\\.\\pipe\\hermes-chrome-bridge-'

  if (path.startsWith(prefix)) { return /^[a-f0-9]{32}$/.test(path.slice(prefix.length)) }

  return platform !== 'win32' && isAbsolute(path)
}

export async function setPrivateWindowsPath(
  path: string,
  directory: boolean,
  run: (args: string[]) => Promise<void> = async args => { await promisify(execFile)('powershell.exe', args, { windowsHide: true }) }
): Promise<void> {
  const encodedPath = Buffer.from(path, 'utf8').toString('base64')

  const script = `$ErrorActionPreference = 'Stop'
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.${directory ? 'DirectorySecurity' : 'FileSecurity'}
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', '${directory ? 'ContainerInherit, ObjectInherit' : 'None'}', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $path -AclObject $acl`

  await run(['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
}

export async function ensurePrivateRuntimeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700, recursive: true })

  if (process.platform === 'win32') { await setPrivateWindowsPath(directory, true) }
  else { await chmod(directory, 0o700) }
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })

    if (process.platform === 'win32') { await setPrivateWindowsPath(temporaryPath, false) }
    else { await chmod(temporaryPath, 0o600) }

    await rename(temporaryPath, path)

    if (process.platform !== 'win32') { await chmod(path, 0o600) }
  } finally {
    await unlink(temporaryPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
    })
  }
}

export interface BrokerClientConfig {
  clientId: string
  socketPath: string
  token: string
  version: 1
}

async function readPrivateConfig(path: string): Promise<Record<string, unknown>> {
  const info = await lstat(path)

  if (!info.isFile() || (process.platform !== 'win32' &&
      ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))) {
    throw new Error('broker configuration must be a private, owned regular file')
  }

  const value: unknown = JSON.parse(await readFile(path, 'utf8'))

  if (value === null || typeof value !== 'object' || Array.isArray(value)) { throw new Error('invalid broker configuration') }

  return value as Record<string, unknown>
}

export async function readBrokerClientConfig(path: string): Promise<BrokerClientConfig> {
  const parsed = await readPrivateConfig(path)

  if (parsed.version !== 1 || typeof parsed.clientId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(parsed.clientId) ||
      typeof parsed.token !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.token) ||
      typeof parsed.socketPath !== 'string' || !isLocalBrokerSocketPath(parsed.socketPath) ||
      !Object.keys(parsed).every(key => ['version', 'clientId', 'socketPath', 'token'].includes(key))) {
    throw new Error('invalid shared broker client configuration')
  }

  return { clientId: parsed.clientId, socketPath: parsed.socketPath, token: parsed.token, version: 1 }
}

export async function readRuntimeConfig(path: string): Promise<RuntimeConfig> {
  const parsed = await readPrivateConfig(path) as Partial<RuntimeConfig>

  if (
    parsed.version !== PROTOCOL_VERSION ||
    typeof parsed.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(parsed.token) ||
    typeof parsed.socketPath !== 'string' ||
    !isLocalBrokerSocketPath(parsed.socketPath) ||
    typeof parsed.statusPath !== 'string' ||
    !isAbsolute(parsed.statusPath) ||
    typeof parsed.origin !== 'string'
  ) {
    throw new Error('invalid Hermes Chrome bridge runtime config')
  }

  if (parsed.clientTokens !== undefined && (parsed.clientTokens === null || typeof parsed.clientTokens !== 'object' ||
      Array.isArray(parsed.clientTokens) || Object.entries(parsed.clientTokens).some(([id, token]) =>
        !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || token === parsed.token))) {
    throw new Error('invalid client enrollment configuration')
  }

  return {
    ...(parsed.clientTokens === undefined ? {} : { clientTokens: parsed.clientTokens }),
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
