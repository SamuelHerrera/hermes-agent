import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'

export interface MacSleepState {
  active: boolean
  sleepDisabled: boolean
}

export type ExecFileLike = (file: string, args: string[]) => Promise<{ stdout: string }>

const SUDOERS_PATH = '/private/etc/sudoers.d/hermes-keep-awake'
const PMSET_COMMAND_PREFIX = '/usr/bin/pmset -a disablesleep'
const LOCAL_USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/

function localAuthorizationRule(username: string): string {
  if (!LOCAL_USERNAME_PATTERN.test(username) || username.toUpperCase() === 'ALL') {
    throw new Error('Cannot install local keep-awake authorization for an unsupported macOS username')
  }

  return `${username} ALL=(root) NOPASSWD: ${PMSET_COMMAND_PREFIX} 0, ${PMSET_COMMAND_PREFIX} 1\n`
}

export function buildLocalAuthorizationInstallScript(username: string): string {
  const encodedRule = Buffer.from(localAuthorizationRule(username), 'utf8').toString('base64')

  const shellScript = [
    'set -eu',
    `/bin/mkdir -p ${SUDOERS_PATH.slice(0, SUDOERS_PATH.lastIndexOf('/'))}`,
    'tmp=$(/usr/bin/mktemp /private/etc/sudoers.d/.hermes-keep-awake.XXXXXX)',
    `trap '/bin/rm -f "$tmp"' EXIT HUP INT TERM`,
    `/usr/bin/printf %s ${encodedRule} | /usr/bin/base64 -D > "$tmp"`,
    '/usr/sbin/chown root:wheel "$tmp"',
    '/bin/chmod 0440 "$tmp"',
    '/usr/sbin/visudo -cf "$tmp" >/dev/null',
    `/bin/mv -f "$tmp" ${SUDOERS_PATH}`
  ].join('; ')

  return `do shell script "/bin/sh -c " & quoted form of ${JSON.stringify(shellScript)} with administrator privileges`
}

function needsLocalAuthorization(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)

  return /password is required|not (?:allowed to execute|in the sudoers file)|may not run sudo/i.test(message)
}

function execFileUtf8(file: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 120_000 }, (error, stdout) => {
      if (error) {
        reject(error)

        return
      }

      resolve({ stdout })
    })
  })
}

export function parseMacSleepState(output: string): MacSleepState {
  const sleepDisabled = /^\s*SleepDisabled\s+(\d+)/m.exec(output)?.[1] === '1'

  return {
    active: sleepDisabled,
    sleepDisabled
  }
}

export function macSleepErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (/user cancel(?:ed|led)|\(-128\)/i.test(message)) {
    return 'Administrator authorization was cancelled'
  }

  return message
}

export function createMacClosedLidSleep(
  exec: ExecFileLike = execFileUtf8,
  username = userInfo().username,
  authorizationInstalled = () => existsSync(SUDOERS_PATH)
) {
  const current = async () => parseMacSleepState((await exec('/usr/bin/pmset', ['-g'])).stdout)
  let mutationTail = Promise.resolve()

  const apply = async (enabled: boolean): Promise<MacSleepState> => {
    const args = ['-n', '/usr/bin/pmset', '-a', 'disablesleep', enabled ? '1' : '0']
    let installedThisAttempt = false

    if (!authorizationInstalled()) {
      await exec('/usr/bin/osascript', ['-e', buildLocalAuthorizationInstallScript(username)])
      installedThisAttempt = true
    }

    try {
      await exec('/usr/bin/sudo', args)
    } catch (error) {
      if (installedThisAttempt || !needsLocalAuthorization(error)) {
        throw error
      }

      await exec('/usr/bin/osascript', ['-e', buildLocalAuthorizationInstallScript(username)])
      await exec('/usr/bin/sudo', args)
    }

    const state = await current()

    if (state.active !== enabled) {
      throw new Error(`macOS did not ${enabled ? 'enable' : 'disable'} the closed-lid sleep guard`)
    }

    return state
  }

  return {
    current,
    set(enabled: boolean): Promise<MacSleepState> {
      const operation = mutationTail.then(() => apply(enabled))

      mutationTail = operation.then(
        () => undefined,
        () => undefined
      )

      return operation
    }
  }
}
