import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const LOCAL_BACKEND_SERVICE_NAME = 'ai.hermes.serve'
export const LOCAL_BACKEND_URL = 'http://127.0.0.1:9119'
export const LOCAL_BACKEND_TOKEN_FILE = 'desktop-serve-token'
export const LOCAL_BACKEND_PROFILE = 'default'

export function localBackendServiceCommand(hermesPath: string) {
  return {
    command: hermesPath,
    args: ['--profile', LOCAL_BACKEND_PROFILE, 'serve', '--host', '127.0.0.1', '--port', '9119', '--skip-build']
  }
}

export function resolveEffectiveLocalProfile(desktopProfile?: string | null, stickyProfile?: string | null): string {
  return desktopProfile || stickyProfile || 'default'
}

export function resolveLocalBackendServiceUrl(override?: string | null): string | null {
  const value = override?.trim() || LOCAL_BACKEND_URL
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      (url.pathname && url.pathname !== '/') ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export function shouldUsePersistentLocalBackend(activeProfile?: string | null): boolean {
  return !activeProfile || activeProfile === 'default'
}

export interface DesktopServiceResult {
  ok: boolean
  action: string
  message: string
  serviceName?: string
  manager?: string
  error?: string
  stdout?: string
  stderr?: string
}

export interface LocalBackendServiceDescriptor {
  installLabel: string
  manager: string
  restartLabel: string
  serviceName: string
  supported: boolean
}

export function localBackendServiceDescriptor(platform: NodeJS.Platform = process.platform): LocalBackendServiceDescriptor {
  if (platform === 'darwin') {
    return {
      installLabel: 'Install always-on local backend',
      manager: 'launchd',
      restartLabel: 'Restart local backend',
      serviceName: LOCAL_BACKEND_SERVICE_NAME,
      supported: true
    }
  }

  if (platform === 'linux') {
    return {
      installLabel: 'Install always-on local backend',
      manager: 'systemd --user',
      restartLabel: 'Restart local backend',
      serviceName: LOCAL_BACKEND_SERVICE_NAME,
      supported: true
    }
  }

  if (platform === 'win32') {
    return {
      installLabel: 'Install always-on local backend',
      manager: 'Scheduled Task',
      restartLabel: 'Restart local backend',
      serviceName: LOCAL_BACKEND_SERVICE_NAME,
      supported: true
    }
  }

  return {
    installLabel: 'Install always-on local backend',
    manager: 'unsupported',
    restartLabel: 'Restart local backend',
    serviceName: LOCAL_BACKEND_SERVICE_NAME,
    supported: false
  }
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function ensureToken(hermesHome: string): string {
  fs.mkdirSync(hermesHome, { recursive: true })
  const tokenPath = path.join(hermesHome, LOCAL_BACKEND_TOKEN_FILE)
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim()
    if (existing) {
      try {
        fs.chmodSync(tokenPath, 0o600)
      } catch {
        // Windows may not support chmod in the POSIX sense; token location is still user-scoped.
      }
      return existing
    }
  } catch {
    // Create below.
  }

  const token = randomBytes(32).toString('base64url')
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 })
  try {
    fs.chmodSync(tokenPath, 0o600)
  } catch {
    // Best effort on Windows.
  }
  return token
}

function shellScript(hermesHome: string, hermesPath: string): string {
  const invocation = localBackendServiceCommand(hermesPath)
  const args = invocation.args.map(quoteShell).join(' ')
  return `#!/bin/bash
set -euo pipefail
export HERMES_HOME=${quoteShell(hermesHome)}
export HERMES_DESKTOP=1
export HERMES_DASHBOARD_SESSION_TOKEN="$(cat "$HERMES_HOME/${LOCAL_BACKEND_TOKEN_FILE}")"
exec ${quoteShell(invocation.command)} ${args}
`
}

function powershellScript(hermesHome: string, hermesPath: string): string {
  const escapedHome = hermesHome.replace(/'/g, "''")
  const escapedHermes = hermesPath.replace(/'/g, "''")
  return `$ErrorActionPreference = 'Stop'
$env:HERMES_HOME = '${escapedHome}'
$env:HERMES_DESKTOP = '1'
$env:HERMES_DASHBOARD_SESSION_TOKEN = (Get-Content -Raw -Path (Join-Path $env:HERMES_HOME '${LOCAL_BACKEND_TOKEN_FILE}')).Trim()
& '${escapedHermes}' --profile default serve --host 127.0.0.1 --port 9119 --skip-build
exit $LASTEXITCODE
`
}

async function runShell(command: string): Promise<{ stderr: string; stdout: string }> {
  const { stderr, stdout } = await execFileAsync('/bin/bash', ['-lc', command], { timeout: 60_000 })
  return { stderr, stdout }
}

async function runPowerShell(command: string): Promise<{ stderr: string; stdout: string }> {
  const shell = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe'
  const { stderr, stdout } = await execFileAsync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    timeout: 60_000
  })
  return { stderr, stdout }
}

function result(action: string, message: string, output: { stderr?: string; stdout?: string } = {}): DesktopServiceResult {
  const descriptor = localBackendServiceDescriptor()
  return {
    action,
    manager: descriptor.manager,
    message,
    ok: true,
    serviceName: descriptor.serviceName,
    stderr: output.stderr,
    stdout: output.stdout
  }
}

function failure(action: string, error: unknown, message = 'Service operation failed'): DesktopServiceResult {
  const descriptor = localBackendServiceDescriptor()
  return {
    action,
    error: error instanceof Error ? error.message : String(error),
    manager: descriptor.manager,
    message,
    ok: false,
    serviceName: descriptor.serviceName
  }
}

export function localBackendServicePaths(hermesHome: string, platform: NodeJS.Platform = process.platform) {
  if (platform === 'win32') {
    return {
      script: path.join(hermesHome, 'bin', 'hermes-serve-daemon.ps1'),
      token: path.join(hermesHome, LOCAL_BACKEND_TOKEN_FILE)
    }
  }

  return {
    script: path.join(hermesHome, 'bin', 'hermes-serve-daemon.sh'),
    token: path.join(hermesHome, LOCAL_BACKEND_TOKEN_FILE)
  }
}

export async function installLocalBackendService({
  hermesHome,
  hermesPath,
  homeDir = os.homedir(),
  platform = process.platform
}: {
  hermesHome: string
  hermesPath: string
  homeDir?: string
  platform?: NodeJS.Platform
}): Promise<DesktopServiceResult> {
  const descriptor = localBackendServiceDescriptor(platform)
  if (!descriptor.supported) {
    return failure('install-local-backend', `Unsupported platform: ${platform}`, 'Always-on backend install is not supported on this platform yet')
  }

  try {
    ensureToken(hermesHome)
    const paths = localBackendServicePaths(hermesHome, platform)
    fs.mkdirSync(path.dirname(paths.script), { recursive: true })

    if (platform === 'darwin') {
      fs.writeFileSync(paths.script, shellScript(hermesHome, hermesPath), { mode: 0o700 })
      fs.chmodSync(paths.script, 0o700)
      const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${LOCAL_BACKEND_SERVICE_NAME}.plist`)
      const stdoutPath = path.join(hermesHome, 'logs', 'serve-launchd.log')
      const stderrPath = path.join(hermesHome, 'logs', 'serve-launchd.err.log')
      fs.mkdirSync(path.dirname(stdoutPath), { recursive: true })
      fs.mkdirSync(path.dirname(plistPath), { recursive: true })
      fs.writeFileSync(
        plistPath,
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LOCAL_BACKEND_SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array><string>${escapeXml(paths.script)}</string></array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrPath)}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(homeDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HERMES_HOME</key>
    <string>${escapeXml(hermesHome)}</string>
    <key>PATH</key>
    <string>${escapeXml(path.dirname(hermesPath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
`,
        { mode: 0o600 }
      )
      fs.chmodSync(plistPath, 0o600)
      const domain = `gui/$(id -u)`
      const command = `PLIST=${quoteShell(plistPath)}; DOMAIN="${domain}"; launchctl print "$DOMAIN/${LOCAL_BACKEND_SERVICE_NAME}" >/dev/null 2>&1 || launchctl bootstrap "$DOMAIN" "$PLIST"; launchctl kickstart -k "$DOMAIN/${LOCAL_BACKEND_SERVICE_NAME}"`
      return result('install-local-backend', 'Always-on local backend installed and started.', await runShell(command))
    }

    if (platform === 'linux') {
      fs.writeFileSync(paths.script, shellScript(hermesHome, hermesPath), { mode: 0o700 })
      fs.chmodSync(paths.script, 0o700)
      const unitPath = path.join(homeDir, '.config', 'systemd', 'user', `${LOCAL_BACKEND_SERVICE_NAME}.service`)
      fs.mkdirSync(path.dirname(unitPath), { recursive: true })
      fs.writeFileSync(
        unitPath,
        `[Unit]
Description=Hermes always-on local backend
After=network.target

[Service]
Type=simple
ExecStart=${paths.script}
Restart=always
RestartSec=3
Environment=HERMES_HOME=${hermesHome}

[Install]
WantedBy=default.target
`,
        { mode: 0o600 }
      )
      const command = `systemctl --user daemon-reload && systemctl --user enable --now ${LOCAL_BACKEND_SERVICE_NAME}.service && systemctl --user restart ${LOCAL_BACKEND_SERVICE_NAME}.service`
      return result('install-local-backend', 'Always-on local backend installed and started.', await runShell(command))
    }

    fs.writeFileSync(paths.script, powershellScript(hermesHome, hermesPath), { mode: 0o600 })
    const taskName = LOCAL_BACKEND_SERVICE_NAME
    const ps = paths.script.replace(/'/g, "''")
    const command = `$task = '${taskName}'; schtasks /Create /F /SC ONLOGON /TN $task /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File '$ps'" | Out-String; schtasks /Run /TN $task | Out-String`
    return result('install-local-backend', 'Always-on local backend installed and started.', await runPowerShell(command))
  } catch (error) {
    return failure('install-local-backend', error)
  }
}

export async function restartLocalBackendService(platform: NodeJS.Platform = process.platform): Promise<DesktopServiceResult> {
  try {
    if (platform === 'darwin') {
      return result(
        'restart-local-backend',
        'Local backend restart requested.',
        await runShell(`launchctl kickstart -k "gui/$(id -u)/${LOCAL_BACKEND_SERVICE_NAME}"`)
      )
    }
    if (platform === 'linux') {
      return result(
        'restart-local-backend',
        'Local backend restart requested.',
        await runShell(`systemctl --user restart ${LOCAL_BACKEND_SERVICE_NAME}.service`)
      )
    }
    if (platform === 'win32') {
      return result(
        'restart-local-backend',
        'Local backend restart requested.',
        await runPowerShell(`schtasks /End /TN ${LOCAL_BACKEND_SERVICE_NAME} | Out-String; schtasks /Run /TN ${LOCAL_BACKEND_SERVICE_NAME} | Out-String`)
      )
    }
    return failure('restart-local-backend', `Unsupported platform: ${platform}`, 'Backend restart is not supported on this platform yet')
  } catch (error) {
    return failure('restart-local-backend', error)
  }
}

export async function restartGatewayService(hermesPath: string): Promise<DesktopServiceResult> {
  try {
    if (process.platform === 'win32') {
      return result('restart-gateway', 'Gateway restart requested.', await execFileAsync(hermesPath, ['gateway', 'restart'], { timeout: 60_000 }))
    }
    return result('restart-gateway', 'Gateway restart requested.', await execFileAsync(hermesPath, ['gateway', 'restart'], { timeout: 60_000 }))
  } catch (error) {
    return failure('restart-gateway', error)
  }
}

export async function localBackendServiceStatus(platform: NodeJS.Platform = process.platform): Promise<DesktopServiceResult> {
  try {
    if (platform === 'darwin') {
      return result(
        'status-local-backend',
        'Local backend service status loaded.',
        await runShell(`launchctl print "gui/$(id -u)/${LOCAL_BACKEND_SERVICE_NAME}" | sed -n '1,80p'`)
      )
    }
    if (platform === 'linux') {
      return result(
        'status-local-backend',
        'Local backend service status loaded.',
        await runShell(`systemctl --user status ${LOCAL_BACKEND_SERVICE_NAME}.service --no-pager`)
      )
    }
    if (platform === 'win32') {
      return result(
        'status-local-backend',
        'Local backend service status loaded.',
        await runPowerShell(`schtasks /Query /TN ${LOCAL_BACKEND_SERVICE_NAME} /V /FO LIST | Out-String`)
      )
    }
    return failure('status-local-backend', `Unsupported platform: ${platform}`, 'Backend status is not supported on this platform yet')
  } catch (error) {
    return failure('status-local-backend', error)
  }
}
