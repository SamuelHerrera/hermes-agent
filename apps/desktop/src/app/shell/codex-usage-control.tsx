import { type CSSProperties, type FocusEvent, type PointerEvent, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { titlebarButtonClass } from './titlebar'

export type CodexUsageControlState = 'available' | 'unavailable' | 'disabled' | 'hidden'

export interface CodexUsageBucket {
  id?: string
  label: string
  usedPercent?: number | null
  resetAt?: string | null
  resetAtRaw?: string | null
  resetCredits?: number | string | null
  remainingPercent?: number | null
  resetWindowMs?: number | null
}

export interface CodexUsageData {
  available?: boolean
  plan?: string | null
  usedPercent?: number | null
  resetAt?: string | null
  resetAtRaw?: string | null
  resetCredits?: number | string | null
  remainingPercent?: number | null
  resetWindowMs?: number | null
  buckets?: readonly CodexUsageBucket[]
}

export interface CodexUsageTitlebarControlProps {
  state?: CodexUsageControlState
  usage?: CodexUsageData | null
}

export function codexUsageRemainingPercent(
  usage?: Pick<CodexUsageData, 'remainingPercent' | 'usedPercent'> | null
): number {
  if (Number.isFinite(usage?.remainingPercent)) {
    return clampPercent(usage?.remainingPercent ?? 0)
  }

  if (Number.isFinite(usage?.usedPercent)) {
    return clampPercent(100 - (usage?.usedPercent ?? 0))
  }

  return 0
}

export function CodexUsageTitlebarControl({ state = 'available', usage }: CodexUsageTitlebarControlProps) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | null>(null)

  if (state === 'hidden') {
    return null
  }

  const unavailable = state === 'unavailable' || usage?.available === false || !usage
  const disabled = state === 'disabled'
  const percentLeft = unavailable ? 0 : codexUsageRemainingPercent(usage)
  const percentUsed = unavailable ? 0 : clampPercent(usage?.usedPercent ?? 100 - percentLeft)
  const resetProgress = unavailable ? 0 : codexUsageResetProgress(usage)
  const buttonLabel = codexUsageButtonLabel({ disabled, percentLeft, resetAt: usage?.resetAt, unavailable })

  const cancelClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const openSoon = () => {
    cancelClose()
    setOpen(true)
  }

  const closeSoon = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpen(false), 80)
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      closeSoon()
    }
  }

  const onPointerEnter = (_event: PointerEvent<HTMLDivElement>) => openSoon()
  const onPointerLeave = (_event: PointerEvent<HTMLDivElement>) => closeSoon()

  return (
    <div
      className="relative"
      onBlur={onBlur}
      onFocus={openSoon}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverAnchor asChild>
          <Button
            aria-disabled={disabled || unavailable || undefined}
            aria-label={buttonLabel}
            className={cn(
              titlebarButtonClass,
              'relative bg-transparent p-0 select-none text-(--ui-text-tertiary)',
              (disabled || unavailable) && 'opacity-60 hover:text-(--ui-text-tertiary)'
            )}
            onPointerDown={event => event.stopPropagation()}
            size="icon-titlebar"
            style={CODEX_USAGE_ICON_STYLE}
            title={buttonLabel}
            type="button"
            variant="ghost"
          >
            <UsageResetIcon
              disabled={disabled}
              percentLeft={percentLeft}
              resetProgress={resetProgress}
              unavailable={unavailable}
            />
          </Button>
        </PopoverAnchor>
        <PopoverContent
          align="end"
          className="w-64 p-0 text-[0.72rem] [-webkit-app-region:no-drag]"
          onPointerEnter={openSoon}
          onPointerLeave={closeSoon}
          side="bottom"
        >
          <CodexUsagePopoverContent
            disabled={disabled}
            percentLeft={percentLeft}
            percentUsed={percentUsed}
            unavailable={unavailable}
            usage={usage}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function UsageResetIcon({
  disabled,
  percentLeft,
  resetProgress,
  unavailable
}: {
  disabled: boolean
  percentLeft: number
  resetProgress: number
  unavailable: boolean
}) {
  const clipId = `codex-usage-core-clip-${useId().replace(/:/g, '')}`
  const remaining = clampPercent(percentLeft)
  const progress = clampUnit(resetProgress)
  const fillHeight = CODEX_USAGE_CORE_SIZE * (remaining / 100)
  const fillY = CODEX_USAGE_CORE_ORIGIN + CODEX_USAGE_CORE_SIZE - fillHeight
  const dotAngle = progress * Math.PI * 2 - Math.PI / 2
  const dotX = 12 + CODEX_USAGE_RESET_RADIUS * Math.cos(dotAngle)
  const dotY = 12 + CODEX_USAGE_RESET_RADIUS * Math.sin(dotAngle)

  const remainingFill =
    unavailable || disabled
      ? 'var(--ui-text-quaternary)'
      : remaining <= 15
        ? 'var(--codex-usage-critical-color)'
        : 'var(--codex-usage-remaining-color)'

  return (
    <svg
      aria-hidden="true"
      className="block size-6 overflow-visible"
      data-critical={remaining <= 15 || undefined}
      style={CODEX_USAGE_ICON_STYLE}
      viewBox="0 0 24 24"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="12" cy="12" r={CODEX_USAGE_CORE_RADIUS} />
        </clipPath>
      </defs>

      <circle
        cx="12"
        cy="12"
        fill="none"
        r={CODEX_USAGE_RESET_RADIUS}
        stroke="var(--codex-usage-track-color)"
        strokeWidth="1.5"
      />
      <circle
        cx="12"
        cy="12"
        data-testid="codex-usage-reset-progress"
        fill="none"
        r={CODEX_USAGE_RESET_RADIUS}
        stroke={disabled || unavailable ? 'var(--ui-text-quaternary)' : 'var(--codex-usage-reset-color)'}
        strokeDasharray={CODEX_USAGE_RESET_CIRCUMFERENCE}
        strokeDashoffset={CODEX_USAGE_RESET_CIRCUMFERENCE * (1 - progress)}
        strokeLinecap="round"
        strokeWidth="1.5"
        style={{
          transform: 'rotate(-90deg)',
          transformOrigin: '12px 12px',
          transition: 'stroke-dashoffset 200ms ease'
        }}
      />
      <circle
        cx="12"
        cy="12"
        fill="color-mix(in srgb, var(--codex-usage-remaining-color) 12%, transparent)"
        r={CODEX_USAGE_CORE_RADIUS}
        stroke="color-mix(in srgb, var(--codex-usage-remaining-color) 48%, transparent)"
        strokeWidth="0.75"
      />
      <g clipPath={`url(#${clipId})`}>
        <rect
          data-testid="codex-usage-fill"
          fill={remainingFill}
          height={fillHeight}
          style={{ transition: 'y 200ms ease, height 200ms ease, fill 200ms ease' }}
          width={CODEX_USAGE_CORE_SIZE}
          x={CODEX_USAGE_CORE_ORIGIN}
          y={fillY}
        />
      </g>
      <circle
        cx={dotX}
        cy={dotY}
        fill={disabled || unavailable ? 'var(--ui-text-quaternary)' : 'var(--codex-usage-reset-color)'}
        r="1.2"
        style={{ transition: 'cx 200ms ease, cy 200ms ease' }}
      />
    </svg>
  )
}

function CodexUsagePopoverContent({
  disabled,
  percentLeft,
  percentUsed,
  unavailable,
  usage
}: {
  disabled: boolean
  percentLeft: number
  percentUsed: number
  unavailable: boolean
  usage?: CodexUsageData | null
}) {
  if (disabled) {
    return (
      <div className="space-y-1.5 p-3">
        <UsageHeader tone="muted" value="Disabled" />
        <p className="text-(--ui-text-quaternary)">Codex usage is disabled for this window.</p>
      </div>
    )
  }

  if (unavailable) {
    return (
      <div className="space-y-1.5 p-3">
        <UsageHeader tone="muted" value="Unavailable" />
        <p className="text-(--ui-text-quaternary)">Codex subscription usage is not available.</p>
      </div>
    )
  }

  const buckets = usage?.buckets?.filter(bucket => bucket.label) ?? []

  return (
    <div className="space-y-3 p-3">
      <UsageHeader tone={percentLeft <= 10 ? 'warn' : 'ok'} value={`${formatPercent(percentLeft)} left`} />

      <div className="space-y-1.5">
        <UsageRow label="Plan" value={usage?.plan || 'Codex'} />
        <UsageRow label="Used" value={`${formatPercent(percentUsed)} used`} />
        <UsageRow label="Reset" value={usage?.resetAt || '—'} />
        <UsageRow label="Reset credits" value={usage?.resetCredits ?? '—'} />
      </div>

      {buckets.length > 0 && (
        <div className="space-y-1.5 border-t border-(--ui-stroke-tertiary) pt-2">
          <div className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-(--ui-text-quaternary)">
            Buckets
          </div>
          {buckets.map((bucket, index) => (
            <BucketRow bucket={bucket} key={bucket.id ?? `${bucket.label}:${index}`} />
          ))}
        </div>
      )}
    </div>
  )
}

function UsageHeader({ tone, value }: { tone: 'ok' | 'muted' | 'warn'; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 font-medium text-(--ui-text-primary)">
        <UsageResetIcon
          disabled={false}
          percentLeft={tone === 'muted' ? 0 : Number.parseInt(value, 10)}
          resetProgress={0}
          unavailable={tone === 'muted'}
        />
        Codex usage
      </div>
      <span
        className={cn(
          'rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium',
          tone === 'ok' && 'border-(--ui-accent)/40 text-(--ui-accent)',
          tone === 'warn' && 'border-(--ui-warm)/40 text-(--ui-warm)',
          tone === 'muted' && 'border-(--ui-stroke-secondary) text-(--ui-text-quaternary)'
        )}
      >
        {value}
      </span>
    </div>
  )
}

function UsageRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-(--ui-text-secondary)">
      <span className="text-(--ui-text-quaternary)">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  )
}

function BucketRow({ bucket }: { bucket: CodexUsageBucket }) {
  const remaining = codexUsageRemainingPercent(bucket)
  const used = clampPercent(bucket.usedPercent ?? 100 - remaining)

  return (
    <div className="space-y-1 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-muted)/40 p-2">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium text-(--ui-text-secondary)">{bucket.label}</span>
        <span className="shrink-0 text-[0.66rem] text-(--ui-text-quaternary)">{formatPercent(remaining)} left</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-(--ui-stroke-secondary)">
        <div
          className="h-full origin-left rounded-full bg-(--ui-accent)"
          style={{ transform: `scaleX(${remaining / 100})` }}
        />
      </div>
      {(bucket.resetAt || bucket.resetCredits != null) && (
        <div className="flex items-center justify-between gap-2 text-[0.64rem] text-(--ui-text-quaternary)">
          <span>{bucket.resetAt || '—'}</span>
          <span>{bucket.resetCredits != null ? `${bucket.resetCredits} credits` : `${formatPercent(used)} used`}</span>
        </div>
      )}
    </div>
  )
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(100, Math.max(0, value))
}

export function codexUsageResetProgress(
  usage?: Pick<CodexUsageData, 'resetAtRaw' | 'resetWindowMs'> | null,
  nowMs = Date.now()
): number {
  const resetMs = new Date(usage?.resetAtRaw ?? '').getTime()
  const resetWindowMs = usage?.resetWindowMs ?? 0

  if (!Number.isFinite(resetMs) || !Number.isFinite(resetWindowMs) || resetWindowMs <= 0) {
    return 0
  }

  const millisecondsLeft = Math.max(0, resetMs - nowMs)

  return clampUnit(1 - millisecondsLeft / Math.max(resetWindowMs, millisecondsLeft))
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(1, Math.max(0, value))
}

function codexUsageButtonLabel({
  disabled,
  percentLeft,
  resetAt,
  unavailable
}: {
  disabled: boolean
  percentLeft: number
  resetAt?: null | string
  unavailable: boolean
}): string {
  if (disabled) {
    return 'Codex usage disabled'
  }

  if (unavailable) {
    return 'Codex usage unavailable'
  }

  const resetText = resetAt ? `; resets ${resetAt}` : ''

  return `Codex usage: ${formatPercent(percentLeft)} allowance left${resetText}`
}

function formatPercent(value: number): string {
  return `${Math.round(clampPercent(value))}%`
}

const CODEX_USAGE_RESET_RADIUS = 9
const CODEX_USAGE_RESET_CIRCUMFERENCE = 2 * Math.PI * CODEX_USAGE_RESET_RADIUS
const CODEX_USAGE_CORE_RADIUS = 5.25
const CODEX_USAGE_CORE_SIZE = 10.5
const CODEX_USAGE_CORE_ORIGIN = 6.75

const CODEX_USAGE_ICON_STYLE = {
  '--codex-usage-critical-color': 'var(--ui-danger, var(--ui-warm))',
  '--codex-usage-remaining-color': 'var(--ui-accent)',
  '--codex-usage-reset-color': 'color-mix(in srgb, var(--ui-accent-secondary, var(--ui-accent)) 58%, #5ed8ff)',
  '--codex-usage-track-color': 'color-mix(in srgb, currentColor 18%, transparent)'
} as CSSProperties
