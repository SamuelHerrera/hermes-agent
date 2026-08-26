import { type FocusEvent, type PointerEvent, useRef, useState } from 'react'

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
  resetCredits?: number | string | null
  remainingPercent?: number | null
}

export interface CodexUsageData {
  available?: boolean
  plan?: string | null
  usedPercent?: number | null
  resetAt?: string | null
  resetCredits?: number | string | null
  remainingPercent?: number | null
  buckets?: readonly CodexUsageBucket[]
}

export interface CodexUsageTitlebarControlProps {
  state?: CodexUsageControlState
  usage?: CodexUsageData | null
}

export function codexUsageRemainingPercent(usage?: Pick<CodexUsageData, 'remainingPercent' | 'usedPercent'> | null): number {
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
    <div className="relative" onBlur={onBlur} onFocus={openSoon} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverAnchor asChild>
          <Button
            aria-disabled={disabled || unavailable || undefined}
            aria-label="Codex subscription usage"
            className={cn(
              titlebarButtonClass,
              'relative bg-transparent select-none text-(--ui-text-tertiary)',
              (disabled || unavailable) && 'opacity-60 hover:text-(--ui-text-tertiary)'
            )}
            onPointerDown={event => event.stopPropagation()}
            size="icon-titlebar"
            type="button"
            variant="ghost"
          >
            <UsageBattery disabled={disabled} percentLeft={percentLeft} unavailable={unavailable} />
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

function UsageBattery({
  disabled,
  percentLeft,
  unavailable
}: {
  disabled: boolean
  percentLeft: number
  unavailable: boolean
}) {
  const fillClass = unavailable || disabled ? 'bg-(--ui-text-quaternary)' : percentLeft <= 10 ? 'bg-(--ui-warm)' : 'bg-(--ui-accent)'

  return (
    <span aria-hidden="true" className="inline-flex items-center gap-px text-(--ui-text-tertiary)" title={`${formatPercent(percentLeft)} left`}>
      <span className="relative h-2.5 w-[1.125rem] overflow-hidden rounded-[0.1875rem] border border-current/60 p-px">
        <span
          className={cn('block h-full rounded-[0.125rem] transition-[width] duration-200', fillClass)}
          data-testid="codex-usage-fill"
          style={{ width: `${percentLeft}%` }}
        />
      </span>
      <span className="h-1.5 w-0.5 rounded-r-[0.125rem] bg-current/60" />
    </span>
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
          <div className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-(--ui-text-quaternary)">Buckets</div>
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
        <UsageBattery disabled={false} percentLeft={tone === 'muted' ? 0 : Number.parseInt(value, 10)} unavailable={tone === 'muted'} />
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
        <div className="h-full origin-left rounded-full bg-(--ui-accent)" style={{ transform: `scaleX(${remaining / 100})` }} />
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

function formatPercent(value: number): string {
  return `${Math.round(clampPercent(value))}%`
}
