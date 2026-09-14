import { afterEach, describe, expect, it } from 'vitest'

import type { CronJob } from '@/types/hermes'

import { $cronJobs, setCronJobs } from './cron'

const job = (over: Partial<CronJob>): CronJob =>
  ({
    enabled: true,
    id: 'job-1',
    name: 'Daily',
    next_run_at: '2026-09-13T10:00:00Z',
    schedule: { display: 'hourly', expr: '0 * * * *', kind: 'cron' },
    state: 'scheduled',
    ...over
  }) as CronJob

afterEach(() => {
  $cronJobs.set([])
})

describe('setCronJobs', () => {
  it('preserves array identity for content-identical refreshes', () => {
    setCronJobs([job({ id: 'a' })])
    const first = $cronJobs.get()

    setCronJobs([job({ id: 'a' })])

    expect($cronJobs.get()).toBe(first)
  })

  it('swaps the array when displayed job state changes', () => {
    setCronJobs([job({ id: 'a', next_run_at: '2026-09-13T10:00:00Z' })])
    const first = $cronJobs.get()

    setCronJobs([job({ id: 'a', next_run_at: '2026-09-13T11:00:00Z' })])

    expect($cronJobs.get()).not.toBe(first)
    expect($cronJobs.get()[0].next_run_at).toBe('2026-09-13T11:00:00Z')
  })
})
