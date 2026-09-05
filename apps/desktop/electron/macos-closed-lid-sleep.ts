import { execFile } from 'node:child_process'

export interface MacSleepState {
  active: boolean
  sleepDisabled: boolean
}

export type ExecFileLike = (file: string, args: string[]) => Promise<{ stdout: string }>

const ENABLE_SCRIPT =
  'do shell script "/usr/bin/pmset -a disablesleep 1" with administrator privileges'

const DISABLE_SCRIPT =
  'do shell script "/usr/bin/pmset -a disablesleep 0" with administrator privileges'

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

export function createMacClosedLidSleep(exec: ExecFileLike = execFileUtf8) {
  const current = async () => parseMacSleepState((await exec('/usr/bin/pmset', ['-g'])).stdout)
  let mutationTail = Promise.resolve()

  const apply = async (enabled: boolean): Promise<MacSleepState> => {
    await exec('/usr/bin/osascript', ['-e', enabled ? ENABLE_SCRIPT : DISABLE_SCRIPT])
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
