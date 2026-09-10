import { afterEach, expect, it, vi } from 'vitest'

import { watchTerminalProcess } from './process-title'

afterEach(() => vi.useRealTimers())

it('follows a quiet foreground app and returns to the shell without duplicate reports', async () => {
  vi.useFakeTimers()
  let name = 'zsh'
  const report = vi.fn()
  const stop = watchTerminalProcess(async () => name, report)
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(report.mock.calls).toEqual([['zsh']])
  name = 'btop'
  await vi.advanceTimersByTimeAsync(1000)
  name = 'zsh'
  await vi.advanceTimersByTimeAsync(1000)
  expect(report.mock.calls).toEqual([['zsh'], ['btop'], ['zsh']])
  stop()
  await vi.advanceTimersByTimeAsync(5000)
  expect(report).toHaveBeenCalledTimes(3)
})

it('does not overlap probes or publish after disposal', async () => {
  vi.useFakeTimers()
  let resolve!: (value: string) => void

  const read = vi.fn(
    () =>
      new Promise<string>(done => {
        resolve = done
      })
  )

  const report = vi.fn()
  const stop = watchTerminalProcess(read, report)
  await vi.advanceTimersByTimeAsync(5000)
  expect(read).toHaveBeenCalledTimes(1)
  stop()
  resolve('btop')
  await vi.advanceTimersByTimeAsync(5000)
  expect(report).not.toHaveBeenCalled()
  expect(read).toHaveBeenCalledTimes(1)
})

it('recovers from a failed or unavailable probe', async () => {
  vi.useFakeTimers()

  const read = vi
    .fn<() => Promise<string | null>>()
    .mockRejectedValueOnce(new Error('disconnected'))
    .mockResolvedValueOnce(null)
    .mockResolvedValue('vim')

  const report = vi.fn()
  const stop = watchTerminalProcess(read, report)
  await vi.advanceTimersByTimeAsync(2000)
  expect(report.mock.calls).toEqual([['vim']])
  stop()
})
