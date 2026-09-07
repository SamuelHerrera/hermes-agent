import { type Codec, persistentAtom } from '@/lib/persisted'

export const STATUS_PULSE_PERIODS_MS = [2_000, 3_000, 5_000] as const
export type StatusPulsePeriodMs = (typeof STATUS_PULSE_PERIODS_MS)[number]

export const DEFAULT_STATUS_PULSE_PERIOD_MS: StatusPulsePeriodMs = 2_000
export const STATUS_PULSE_PERIOD_STORAGE_KEY = 'hermes.desktop.statusPulsePeriodMs.v1'

export function resolveStatusPulsePeriodMs(value: unknown): StatusPulsePeriodMs {
  const parsed = typeof value === 'number' ? value : Number(value)

  return STATUS_PULSE_PERIODS_MS.includes(parsed as StatusPulsePeriodMs)
    ? (parsed as StatusPulsePeriodMs)
    : DEFAULT_STATUS_PULSE_PERIOD_MS
}

const statusPulsePeriodCodec: Codec<StatusPulsePeriodMs> = {
  decode: resolveStatusPulsePeriodMs,
  encode: value => String(value)
}

/** Local visual preference: how often finite live-status animations replay. */
export const $statusPulsePeriodMs = persistentAtom(
  STATUS_PULSE_PERIOD_STORAGE_KEY,
  DEFAULT_STATUS_PULSE_PERIOD_MS,
  statusPulsePeriodCodec
)

export function setStatusPulsePeriodMs(periodMs: number): void {
  $statusPulsePeriodMs.set(resolveStatusPulsePeriodMs(periodMs))
}
