import { beforeEach, describe, expect, it } from 'vitest'

import {
  $statusPulsePeriodMs,
  DEFAULT_STATUS_PULSE_PERIOD_MS,
  resolveStatusPulsePeriodMs,
  setStatusPulsePeriodMs,
  STATUS_PULSE_PERIOD_STORAGE_KEY
} from './status-pulse'

describe('status pulse preference', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setStatusPulsePeriodMs(DEFAULT_STATUS_PULSE_PERIOD_MS)
  })

  it('accepts supported periods and falls back for invalid persisted values', () => {
    expect(resolveStatusPulsePeriodMs('2000')).toBe(2_000)
    expect(resolveStatusPulsePeriodMs(3_000)).toBe(3_000)
    expect(resolveStatusPulsePeriodMs('5000')).toBe(5_000)
    expect(resolveStatusPulsePeriodMs('1000')).toBe(DEFAULT_STATUS_PULSE_PERIOD_MS)
    expect(resolveStatusPulsePeriodMs('fast')).toBe(DEFAULT_STATUS_PULSE_PERIOD_MS)
  })

  it('persists the selected period', () => {
    setStatusPulsePeriodMs(5_000)

    expect($statusPulsePeriodMs.get()).toBe(5_000)
    expect(window.localStorage.getItem(STATUS_PULSE_PERIOD_STORAGE_KEY)).toBe('5000')
  })
})
