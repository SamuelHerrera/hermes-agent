import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import type { StatusbarItem } from '@/app/shell/statusbar-controls'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { Zap, ZapFilled } from '@/lib/icons'
import {
  $approvalModes,
  type ApprovalMode,
  type ApprovalModeRequester,
  setApprovalModeForProfile,
  syncApprovalModeForProfile
} from '@/store/approval-mode'

export function useApprovalModeStatusbarItem(profile: string, requestGateway: ApprovalModeRequester): StatusbarItem {
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const modes = useStore($approvalModes)
  const mode = modes[profile.trim() || 'default'] ?? 'smart'

  const labels = useMemo<Record<ApprovalMode, string>>(
    () => ({ manual: copy.manual, smart: copy.smart, off: copy.off }),
    [copy.manual, copy.off, copy.smart]
  )

  const descriptions = useMemo<Record<ApprovalMode, string>>(
    () => ({
      manual: copy.manualDescription,
      smart: copy.smartDescription,
      off: copy.offDescription
    }),
    [copy.manualDescription, copy.offDescription, copy.smartDescription]
  )

  useEffect(() => {
    void syncApprovalModeForProfile(requestGateway, profile).catch(() => undefined)
  }, [profile, requestGateway])

  return {
    icon: <ApprovalStrikeIcon mode={mode} />,
    id: 'approval-mode',
    label: labels[mode],
    menuAlign: 'end',
    menuClassName: 'w-72 p-1',
    menuContent: (
      <>
        <DropdownMenuLabel>{copy.title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          onValueChange={value => {
            void setApprovalModeForProfile(requestGateway, profile, value as ApprovalMode).catch(() => undefined)
          }}
          value={mode}
        >
          {(['manual', 'smart', 'off'] as const).map(value => (
            <DropdownMenuRadioItem className="items-start gap-2" key={value} value={value}>
              <ApprovalStrikeIcon className="mt-0.5" mode={value} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs text-foreground">{labels[value]}</span>
                <span className="text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">{descriptions[value]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </>
    ),
    title: copy.ariaLabel(labels[mode]),
    variant: 'menu'
  }
}

function ApprovalStrikeIcon({ className, mode }: { className?: string; mode: ApprovalMode }) {
  const filled = mode === 'off' ? 'full' : mode === 'smart' ? 'half' : 'empty'

  return (
    <span
      aria-hidden="true"
      className={[
        'relative inline-grid size-3.5 shrink-0 place-items-center text-(--ui-text-tertiary)',
        mode !== 'manual' ? 'text-foreground' : '',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
      data-fill={filled}
      data-testid={`approval-strike-${mode}`}
    >
      <Zap className={filled === 'empty' ? 'size-3.5 opacity-65' : 'size-3.5 opacity-30'} />
      {filled !== 'empty' && (
        <span className={filled === 'half' ? 'absolute inset-y-0 left-0 overflow-hidden w-1/2' : 'absolute inset-0'}>
          <ZapFilled className="size-3.5" />
        </span>
      )}
    </span>
  )
}
