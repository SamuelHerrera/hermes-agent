import { describe, expect, it, vi } from 'vitest'

import {
  buildLocalAuthorizationInstallScript,
  createMacClosedLidSleep,
  macSleepErrorMessage,
  parseMacSleepState
} from './macos-closed-lid-sleep'

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
  it('uses the preauthorized exact pmset command without opening an administrator prompt', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' SleepDisabled\t\t1\n sleep                0' })

    const control = createMacClosedLidSleep(exec, 'samuel', () => true)

    await expect(control.set(true)).resolves.toMatchObject({ active: true })
    expect(exec).toHaveBeenNthCalledWith(1, '/usr/bin/sudo', [
      '-n',
      '/usr/bin/pmset',
      '-a',
      'disablesleep',
      '1'
    ])
    expect(exec).toHaveBeenNthCalledWith(2, '/usr/bin/pmset', ['-g'])
    expect(exec).not.toHaveBeenCalledWith('/usr/bin/osascript', expect.anything())
  })

  it('installs authorization when its root-owned policy file is missing even if sudo has a cached credential', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' SleepDisabled\t\t1\n sleep                1' })

    const control = createMacClosedLidSleep(exec, 'samuel', () => false)

    await expect(control.set(true)).resolves.toMatchObject({ active: true })
    expect(exec).toHaveBeenNthCalledWith(1, '/usr/bin/osascript', [
      '-e',
      expect.stringContaining('with administrator privileges')
    ])
    expect(exec).toHaveBeenNthCalledWith(2, '/usr/bin/sudo', [
      '-n',
      '/usr/bin/pmset',
      '-a',
      'disablesleep',
      '1'
    ])
  })

  it('repairs the narrow local authorization when sudo requires a password', async () => {
    const exec = vi
      .fn()
      .mockRejectedValueOnce(new Error('sudo: a password is required'))
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' SleepDisabled\t\t1\n sleep                1' })

    const control = createMacClosedLidSleep(exec, 'samuel', () => true)

    await expect(control.set(true)).resolves.toMatchObject({ active: true })
    expect(exec).toHaveBeenNthCalledWith(2, '/usr/bin/osascript', [
      '-e',
      expect.stringMatching(/visudo.*hermes-keep-awake.*with administrator privileges/)
    ])
    expect(exec).toHaveBeenNthCalledWith(3, '/usr/bin/sudo', [
      '-n',
      '/usr/bin/pmset',
      '-a',
      'disablesleep',
      '1'
    ])
  })

  it('offers the same one-time setup when the current user is not yet in sudoers', async () => {
    const exec = vi
      .fn()
      .mockRejectedValueOnce(new Error('sudo: samuel is not in the sudoers file.'))
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' SleepDisabled\t\t1\n sleep                1' })

    const control = createMacClosedLidSleep(exec, 'samuel', () => true)

    await expect(control.set(true)).resolves.toMatchObject({ active: true })
    expect(exec).toHaveBeenNthCalledWith(2, '/usr/bin/osascript', [
      '-e',
      expect.stringContaining('with administrator privileges')
    ])
  })

  it('does not open an administrator prompt for an unrelated pmset failure', async () => {
    const exec = vi.fn().mockRejectedValueOnce(new Error('pmset: operation is not supported'))
    const control = createMacClosedLidSleep(exec, 'samuel', () => true)

    await expect(control.set(true)).rejects.toThrow('operation is not supported')
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec).not.toHaveBeenCalledWith('/usr/bin/osascript', expect.anything())
  })

  it('stops after the one-time installer is cancelled', async () => {
    const exec = vi.fn().mockRejectedValueOnce(new Error('User canceled. (-128)'))
    const control = createMacClosedLidSleep(exec, 'samuel', () => false)

    await expect(control.set(true)).rejects.toThrow('User canceled')
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledWith('/usr/bin/osascript', [
      '-e',
      expect.stringContaining('with administrator privileges')
    ])
  })

  it('restores normal sleep through the same authorized path', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' SleepDisabled\t\t0\n sleep                1' })

    const control = createMacClosedLidSleep(exec, 'samuel', () => true)

    await expect(control.set(false)).resolves.toMatchObject({ active: false })
    expect(exec).toHaveBeenNthCalledWith(1, '/usr/bin/sudo', [
      '-n',
      '/usr/bin/pmset',
      '-a',
      'disablesleep',
      '0'
    ])
  })

  it('rejects a command that did not produce the requested state', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' SleepDisabled\t\t0\n sleep                1' })

    const control = createMacClosedLidSleep(exec, 'samuel', () => true)

    await expect(control.set(true)).rejects.toThrow('macOS did not enable the closed-lid sleep guard')
  })

  it('serializes concurrent requests so the latest intent is applied last', async () => {
    let releaseEnable!: () => void
    let sleepDisabled = false

    const exec = vi.fn(async (file: string, args: string[]) => {
      if (file === '/usr/bin/sudo' && args.at(-1) === '1') {
        await new Promise<void>(resolve => (releaseEnable = resolve))
        sleepDisabled = true
      } else if (file === '/usr/bin/sudo') {
        sleepDisabled = false
      }

      return { stdout: file === '/usr/bin/pmset' ? `SleepDisabled ${sleepDisabled ? 1 : 0}` : '' }
    })

    const control = createMacClosedLidSleep(exec, 'samuel', () => true)

    const enable = control.set(true)
    const disable = control.set(false)

    await vi.waitFor(() => expect(releaseEnable).toBeTypeOf('function'))
    expect(exec).toHaveBeenCalledTimes(1)

    releaseEnable()
    await expect(enable).resolves.toMatchObject({ active: true })
    await expect(disable).resolves.toMatchObject({ active: false })

    expect(exec.mock.calls.filter(([file]) => file === '/usr/bin/sudo').map(([, args]) => args.at(-1))).toEqual(['1', '0'])
  })
})

describe('buildLocalAuthorizationInstallScript', () => {
  it('installs only the two exact pmset commands after validating the sudoers file', () => {
    const script = buildLocalAuthorizationInstallScript('samuel')
    const encodedRule = /printf %s ([A-Za-z0-9+/=]+)/.exec(script)?.[1]

    expect(encodedRule).toBeTruthy()
    expect(Buffer.from(encodedRule!, 'base64').toString('utf8')).toBe(
      'samuel ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1\n'
    )
    expect(script.indexOf('/usr/sbin/visudo')).toBeLessThan(script.indexOf('/bin/mv'))
  })

  it('rejects a username that could alter the sudoers rule', () => {
    expect(() => buildLocalAuthorizationInstallScript('samuel ALL=(ALL) NOPASSWD: ALL')).toThrow(
      'unsupported macOS username'
    )
  })

  it('rejects the sudoers ALL wildcard as a username', () => {
    expect(() => buildLocalAuthorizationInstallScript('ALL')).toThrow('unsupported macOS username')
  })
})

describe('macSleepErrorMessage', () => {
  it('turns native authorization cancellation into a clear message', () => {
    expect(macSleepErrorMessage(new Error('User canceled. (-128)'))).toBe('Administrator authorization was cancelled')
  })
})
