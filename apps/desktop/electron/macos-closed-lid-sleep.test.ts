import { describe, expect, it, vi } from 'vitest'

import { createMacClosedLidSleep, macSleepErrorMessage, parseMacSleepState } from './macos-closed-lid-sleep'

describe('parseMacSleepState', () => {
  it('reports the privileged closed-lid guard without changing the user sleep timer', () => {
    expect(parseMacSleepState(' SleepDisabled\t\t1\n sleep                0')).toEqual({
      active: true,
      sleepDisabled: true
    })
    expect(parseMacSleepState(' SleepDisabled\t\t0\n sleep                1')).toEqual({
      active: false,
      sleepDisabled: false
    })
  })
})

describe('createMacClosedLidSleep', () => {
  it('enables and verifies the macOS closed-lid guard through native authorization', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' SleepDisabled\t\t1\n sleep                0' })

    const control = createMacClosedLidSleep(exec)

    await expect(control.set(true)).resolves.toMatchObject({ active: true })
    expect(exec).toHaveBeenNthCalledWith(1, '/usr/bin/osascript', [
      '-e',
      'do shell script "/usr/bin/pmset -a disablesleep 1" with administrator privileges'
    ])
    expect(exec).toHaveBeenNthCalledWith(2, '/usr/bin/pmset', ['-g'])
  })

  it('restores normal sleep through the same authorized path', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' SleepDisabled\t\t0\n sleep                1' })

    const control = createMacClosedLidSleep(exec)

    await expect(control.set(false)).resolves.toMatchObject({ active: false })
    expect(exec).toHaveBeenNthCalledWith(1, '/usr/bin/osascript', [
      '-e',
      'do shell script "/usr/bin/pmset -a disablesleep 0" with administrator privileges'
    ])
  })

  it('rejects a command that did not produce the requested state', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' SleepDisabled\t\t0\n sleep                1' })

    const control = createMacClosedLidSleep(exec)

    await expect(control.set(true)).rejects.toThrow('macOS did not enable the closed-lid sleep guard')
  })

  it('serializes concurrent requests so the latest intent is applied last', async () => {
    let releaseEnable!: () => void
    let sleepDisabled = false

    const exec = vi.fn(async (file: string, args: string[]) => {
      if (file === '/usr/bin/osascript' && args[1].includes('disablesleep 1')) {
        await new Promise<void>(resolve => (releaseEnable = resolve))
        sleepDisabled = true
      } else if (file === '/usr/bin/osascript') {
        sleepDisabled = false
      }

      return { stdout: file === '/usr/bin/pmset' ? `SleepDisabled ${sleepDisabled ? 1 : 0}` : '' }
    })

    const control = createMacClosedLidSleep(exec)

    const enable = control.set(true)
    const disable = control.set(false)

    await vi.waitFor(() => expect(releaseEnable).toBeTypeOf('function'))
    expect(exec).toHaveBeenCalledTimes(1)

    releaseEnable()
    await expect(enable).resolves.toMatchObject({ active: true })
    await expect(disable).resolves.toMatchObject({ active: false })

    expect(exec.mock.calls.filter(([file]) => file === '/usr/bin/osascript').map(([, args]) => args[1])).toEqual([
      expect.stringContaining('disablesleep 1'),
      expect.stringContaining('disablesleep 0')
    ])
  })
})

describe('macSleepErrorMessage', () => {
  it('turns native authorization cancellation into a clear message', () => {
    expect(macSleepErrorMessage(new Error('User canceled. (-128)'))).toBe('Administrator authorization was cancelled')
  })
})
