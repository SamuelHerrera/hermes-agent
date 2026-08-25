import { useStore } from '@nanostores/react'
import { type ComponentProps, type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { hudTargetSessionId } from '@/app/hud/handoff'
import { toggleLayoutEditMode } from '@/components/pane-shell/edit-mode'
import { resetLayoutTree } from '@/components/pane-shell/tree/store'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ProfileGlyph } from '@/components/ui/profile-glyph'
import { Tip, TipKeybindLabel } from '@/components/ui/tooltip'
import { ContribRender } from '@/contrib/react/boundary'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { resolveProfileColor } from '@/lib/profile-color'
import { cn } from '@/lib/utils'
import { $hapticsMuted, toggleHapticsMuted } from '@/store/haptics'
import { toggleHud } from '@/store/hud'
import {
  $sidebarOpen,
  toggleSidebarOpen
} from '@/store/layout'
import { notify, notifyError } from '@/store/notifications'
import {
  $activeGatewayProfile,
  $profileColors,
  $profileOrder,
  $profiles,
  $showAllProfiles,
  ALL_PROFILES,
  normalizeProfileKey,
  refreshActiveProfile,
  selectProfile,
  setShowAllProfiles,
  sortByProfileOrder
} from '@/store/profile'
import { openRouteTile } from '@/store/route-tiles'
import { $connection } from '@/store/session'
import { $statusbarHiddenIds } from '@/store/statusbar-prefs'
import type { ProfileInfo } from '@/types/hermes'

import {
  appViewForPath,
  ARTIFACTS_ROUTE,
  isOverlayView,
  MESSAGING_ROUTE,
  SKILLS_ROUTE
} from '../routes'

import { type CodexUsageControlState, type CodexUsageData, CodexUsageTitlebarControl } from './codex-usage-control'
import type { StatusbarItem } from './statusbar-controls'
import {
  TITLEBAR_ICON_BADGE_SCALE,
  titlebarButtonClass,
  titlebarIconSizeCss,
  titlebarToolClusterClass
} from './titlebar'
import { TitlebarIcon } from './titlebar-icon'

export interface TitlebarTool {
  id: string
  label: string
  active?: boolean
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  icon: ReactNode
  onSelect?: (event?: MouseEvent) => void
  /** Keybind action id — when set, the tooltip shows the label + keybind hint. */
  actionId?: string
  title?: string
  to?: string
}

export type TitlebarToolSide = 'left' | 'right'
export type SetTitlebarToolGroup = (id: string, tools: readonly TitlebarTool[], side?: TitlebarToolSide) => void

interface TitlebarControlsProps extends ComponentProps<'div'> {
  codexUsage?: CodexUsageData | null
  codexUsageState?: CodexUsageControlState
  leftTools?: readonly TitlebarTool[]
  statusbarLeftItems?: readonly StatusbarItem[]
  statusbarItems?: readonly StatusbarItem[]
  tools?: readonly TitlebarTool[]
  onOpenSettings: () => void
}

/**
 * The layout button's glyph. Morphs into its composite reset form — the
 * layout icon wearing a small counter-clockwise arrow badge ("layout, back
 * to how it was") — ONLY while the pointer is on the button AND ⌘/Ctrl is
 * held: hover gates via CSS (`group/tool` on the button), the modifier via
 * the window listener. Pressing the modifier elsewhere changes nothing.
 */
function LayoutGlyph({ modHeld }: { modHeld: boolean }) {
  return (
    <>
      <span className={cn('inline-flex', modHeld && 'group-hover/tool:hidden')}>
        <TitlebarIcon name="layout" />
      </span>
      <span className={cn('relative hidden', modHeld && 'group-hover/tool:inline-flex')}>
        <TitlebarIcon name="layout" />
        <span className="absolute -bottom-1 -right-1.5 grid place-items-center rounded-full bg-(--ui-bg-chrome) p-px">
          <TitlebarIcon className="-scale-x-100" name="refresh" size={titlebarIconSizeCss(TITLEBAR_ICON_BADGE_SCALE)} />
        </span>
      </span>
    </>
  )
}

/** Live ⌘/Ctrl tracking — mod-click affordances telegraph themselves (the
 *  layout button morphs into its reset form while the modifier is down). */
function useModifierHeld(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const sync = (event: KeyboardEvent) => setHeld(event.metaKey || event.ctrlKey)
    const clear = () => setHeld(false)

    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', clear)

    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return held
}

function orderedProfiles(profiles: ProfileInfo[], order: string[]): ProfileInfo[] {
  const defaultProfile = profiles.find(profile => profile.is_default)
  const namedProfiles = sortByProfileOrder(profiles.filter(profile => !profile.is_default), order)

  return defaultProfile ? [defaultProfile, ...namedProfiles] : namedProfiles
}

function profileDisplayName(profile: ProfileInfo | undefined, activeKey: string): string {
  if (profile) {
    return profile.name
  }

  return activeKey || 'default'
}

/** Compact titlebar profile switcher: active profile image + dropdown list.
 *  Profile creation/import stay out of this chrome by design. */
function TitlebarProfileMenu() {
  const { t } = useI18n()
  const p = t.profiles
  const profiles = useStore($profiles)
  const order = useStore($profileOrder)
  const colors = useStore($profileColors)
  const gatewayProfile = useStore($activeGatewayProfile)
  const showAllProfiles = useStore($showAllProfiles)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void refreshActiveProfile()
  }, [])

  const activeKey = normalizeProfileKey(gatewayProfile)
  const rows = orderedProfiles(profiles, order)
  const activeProfile = rows.find(profile => normalizeProfileKey(profile.name) === activeKey) ?? rows.find(profile => profile.is_default)
  const activeName = profileDisplayName(activeProfile, activeKey)
  const activeColor = activeProfile?.is_default ? null : resolveProfileColor(activeName, colors)
  const triggerLabel = showAllProfiles ? p.allProfiles : p.switchToProfile(activeName)
  const currentScope = showAllProfiles ? ALL_PROFILES : activeKey

  return (
    <DropdownMenu
      onOpenChange={next => {
        setOpen(next)

        if (next) {
          void refreshActiveProfile()
        }
      }}
      open={open}
    >
      <Tip label={triggerLabel}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={p.title}
            className={cn(
              titlebarButtonClass,
              'w-auto gap-1 bg-transparent px-1.5 select-none data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground'
            )}
            onPointerDown={event => event.stopPropagation()}
            size="icon-titlebar"
            type="button"
            variant="ghost"
          >
            <ProfileGlyph
              aria-hidden="true"
              className="size-3.5"
              color={activeColor}
              isDefault={activeProfile?.is_default ?? activeKey === 'default'}
              name={activeName}
            />
            <Codicon className="text-(--ui-text-tertiary)" name="chevron-down" size="0.625rem" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel>{p.title}</DropdownMenuLabel>
        {rows.length > 1 && (
          <>
            <DropdownMenuCheckboxItem checked={currentScope === ALL_PROFILES} onSelect={() => setShowAllProfiles(true)}>
              <Codicon className="text-(--ui-text-tertiary)" name="layers" size="0.8125rem" />
              <span className="truncate">{p.allProfiles}</span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        )}
        {rows.length === 0 ? (
          <DropdownMenuItem disabled>
            <ProfileGlyph aria-hidden="true" color={null} isDefault name="default" />
            <span className="truncate">default</span>
          </DropdownMenuItem>
        ) : (
          rows.map(profile => {
            const key = normalizeProfileKey(profile.name)
            const selected = currentScope === key

            return (
              <DropdownMenuCheckboxItem
                checked={selected}
                key={profile.name}
                onSelect={() => selectProfile(profile.name)}
              >
                <ProfileGlyph
                  aria-hidden="true"
                  color={profile.is_default ? null : resolveProfileColor(profile.name, colors)}
                  isDefault={profile.is_default}
                  name={profile.name}
                />
                <span className="truncate">{profile.name}</span>
              </DropdownMenuCheckboxItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TitlebarControls({
  codexUsage,
  codexUsageState = 'unavailable',
  leftTools = [],
  statusbarLeftItems = [],
  statusbarItems = [],
  tools = [],
  onOpenSettings
}: TitlebarControlsProps) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const modHeld = useModifierHeld()
  const hapticsMuted = useStore($hapticsMuted)
  const sidebarOpen = useStore($sidebarOpen)
  const hiddenStatusbarIds = useStore($statusbarHiddenIds)
  const connection = useStore($connection)
  const [serviceBusy, setServiceBusy] = useState<null | 'backend' | 'gateway'>(null)
  const canManageLocalServices = Boolean(window.hermesDesktop?.localServices) && connection?.mode === 'local'

  const runServiceAction = async (kind: 'backend' | 'gateway') => {
    const services = window.hermesDesktop?.localServices

    if (!services) {
      return
    }

    setServiceBusy(kind)

    try {
      const response = kind === 'backend' ? await services.restartBackend() : await services.restartGateway()

      if (!response.ok) {
        throw new Error(response.error || response.message || 'Service operation failed')
      }

      notify({ kind: 'success', title: t.settings.gateway.localServicesUpdatedTitle, message: response.message })
    } catch (error) {
      notifyError(error, t.settings.gateway.localServicesFailed)
    } finally {
      setServiceBusy(null)
    }
  }

  const toggleHaptics = () => {
    if (!hapticsMuted) {
      triggerHaptic('tap')
    }

    toggleHapticsMuted()

    if (hapticsMuted) {
      window.requestAnimationFrame(() => triggerHaptic('success'))
    }
  }

  // The left chrome toggle owns the fixed sessions/files panel.
  const leftEdge = { open: sidebarOpen, toggle: toggleSidebarOpen }

  const leftToolbarTools: TitlebarTool[] = [
    {
      actionId: 'view.toggleSidebar',
      icon: <TitlebarIcon name="layout-sidebar-left" />,
      id: 'sidebar',
      label: leftEdge.open ? t.titlebar.hideSidebar : t.titlebar.showSidebar,
      onSelect: () => {
        triggerHaptic('tap')
        leftEdge.toggle()
      }
    },
    ...leftTools
  ]

  // Workspace pages live in the main pane but are global app destinations, so
  // keep their affordances in the app header instead of the sessions sidebar.
  const workspacePageTools: TitlebarTool[] = [
    {
      actionId: 'nav.skills',
      active: appViewForPath(location.pathname) === 'skills',
      icon: <TitlebarIcon name="symbol-misc" />,
      id: 'skills',
      label: t.sidebar.nav.skills,
      onSelect: () => openRouteTile(SKILLS_ROUTE, 'center')
    },
    {
      actionId: 'nav.messaging',
      active: appViewForPath(location.pathname) === 'messaging',
      icon: <TitlebarIcon name="comment" />,
      id: 'messaging',
      label: t.sidebar.nav.messaging,
      onSelect: () => openRouteTile(MESSAGING_ROUTE, 'center')
    },
    {
      actionId: 'nav.artifacts',
      active: appViewForPath(location.pathname) === 'artifacts',
      icon: <TitlebarIcon name="files" />,
      id: 'artifacts',
      label: t.sidebar.nav.artifacts,
      onSelect: () => openRouteTile(ARTIFACTS_ROUTE, 'center')
    }
  ]

  const localServiceTools: TitlebarTool[] = canManageLocalServices
    ? [
        {
          disabled: serviceBusy !== null,
          icon: <TitlebarIcon name="server-process" spinning={serviceBusy === 'backend'} />,
          id: 'restart-backend',
          label: t.settings.gateway.restartBackend,
          onSelect: () => void runServiceAction('backend'),
          title: t.settings.gateway.restartBackend
        },
        {
          disabled: serviceBusy !== null,
          icon: <TitlebarIcon name="refresh" spinning={serviceBusy === 'gateway'} />,
          id: 'restart-gateway',
          label: t.settings.gateway.restartGateway,
          onSelect: () => void runServiceAction('gateway'),
          title: t.settings.gateway.restartGateway
        }
      ]
    : []

  // Static system tools — always pinned to the screen's right edge.
  const systemTools: TitlebarTool[] = [
    {
      className: 'group/tool',
      // Hover + held ⌘/Ctrl morphs the glyph into its reset form (see
      // LayoutGlyph) — the mod-click telegraphs itself before it happens.
      icon: <LayoutGlyph modHeld={modHeld} />,
      id: 'layout',
      label: t.titlebar.layoutEditor,
      onSelect: event => {
        if (event?.metaKey || event?.ctrlKey) {
          triggerHaptic('warning')
          resetLayoutTree()

          return
        }

        triggerHaptic('open')
        toggleLayoutEditMode()
      },
      title: t.titlebar.layoutEditorTitle
    },
    {
      // No `title`: TitlebarToolButton passes `title` to TipKeybindLabel as a
      // text OVERRIDE, so a long sentence there replaces the short label and
      // crowds the ⌘⇧H hint off the tooltip. Label only — the hint is appended
      // from the action registry, same as every other tool here.
      actionId: 'view.toggleHud',
      icon: <TitlebarIcon name="comment-discussion" />,
      id: 'hud',
      label: t.titlebar.enterHud,
      onSelect: () => {
        triggerHaptic('open')
        toggleHud(hudTargetSessionId())
      }
    },
    {
      active: hapticsMuted,
      icon: <TitlebarIcon name={hapticsMuted ? 'mute' : 'unmute'} />,
      id: 'haptics',
      label: hapticsMuted ? t.titlebar.unmuteHaptics : t.titlebar.muteHaptics,
      onSelect: toggleHaptics
    },
    {
      actionId: 'nav.settings',
      icon: <TitlebarIcon name="settings-gear" />,
      id: 'settings',
      label: t.titlebar.openSettings,
      onSelect: () => {
        triggerHaptic('open')
        onOpenSettings()
      }
    }
  ]

  // While a full-screen overlay (settings, command center, …) is open it should
  // visually own the window. These control clusters are `fixed` at a higher
  // z-index than the overlay card, so they'd otherwise bleed over it — hide them
  // and let the overlay's own chrome (close button, drag region) take over.
  if (isOverlayView(appViewForPath(location.pathname))) {
    return null
  }

  const visibleSystemTools = systemTools.filter(tool => !tool.hidden)
  const visibleWorkspacePageTools = workspacePageTools.filter(tool => !tool.hidden)
  const visiblePaneTools = tools.filter(tool => !tool.hidden)

  const visibleStatusbarItems = [...statusbarLeftItems, ...statusbarItems].filter(
    item => !item.hidden && (item.lockedVisible || !item.toggleLabel || !hiddenStatusbarIds.includes(item.id))
  )

  return (
    <>
      <div
        aria-label={t.shell.windowControls}
        className={cn(
          titlebarToolClusterClass,
          'left-(--titlebar-controls-left) top-(--titlebar-controls-top) translate-y-(--titlebar-controls-y-nudge)'
        )}
      >
        {leftToolbarTools
          .filter(tool => !tool.hidden)
          .map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
      </div>

      {/*
        Pane-scoped tools (preview's monitor / devtools / refresh / X) render
        as their own fixed cluster. AppShell sets --shell-preview-toolbar-gap
        to either the static cluster's width (file-browser closed → cluster
        sits flush against system tools) or the file-browser pane's width
        (file-browser open → cluster sits flush against the file-browser pane,
        i.e. at the preview pane's right edge). No margin hacks needed.
      */}
      {visiblePaneTools.length > 0 && (
        <div
          aria-label={t.shell.paneControls}
          className={cn(
            titlebarToolClusterClass,
            'top-[calc(var(--titlebar-controls-top)+var(--right-rail-top-inset,0px))] right-[calc(var(--titlebar-tools-right)+var(--shell-preview-toolbar-gap,0))]'
          )}
        >
          {visiblePaneTools.map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
        </div>
      )}

      <div
        aria-label={t.shell.appControls}
        className={cn(titlebarToolClusterClass, 'right-(--titlebar-tools-right) top-(--titlebar-controls-top)')}
      >
        {visibleStatusbarItems.map(item => (
          <TitlebarStatusbarItemButton item={item} key={`status:${item.id}`} navigate={navigate} />
        ))}
        {visibleWorkspacePageTools.map(tool => (
          <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
        ))}
        <CodexUsageTitlebarControl state={codexUsageState} usage={codexUsage} />
        {localServiceTools.map(tool => (
          <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
        ))}
        <TitlebarProfileMenu />
        {visibleSystemTools.map(tool => (
          <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
        ))}
      </div>
    </>
  )
}

function statusbarTooltip(item: StatusbarItem): ReactNode {
  if (item.actionId) {
    return <TipKeybindLabel actionId={item.actionId} text={item.title} />
  }

  return item.title ?? item.label
}

function TitlebarStatusbarItemButton({
  item,
  navigate
}: {
  item: StatusbarItem
  navigate: ReturnType<typeof useNavigate>
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  if (item.render) {
    return (
      <span className="flex h-(--titlebar-control-height) items-center" data-titlebar-statusbar-item={item.id}>
        <ContribRender render={item.render} />
      </span>
    )
  }

  const tooltipLabel = statusbarTooltip(item)
  const menuContent = typeof item.menuContent === 'function' ? item.menuContent(() => setMenuOpen(false)) : item.menuContent
  const hasMenu = item.variant === 'menu' || Boolean(menuContent) || Boolean(item.menuItems?.length)

  const content = (
    <>
      {item.icon}
      {!item.icon && item.label ? <span className="max-w-16 truncate text-[0.625rem] leading-none">{item.label}</span> : null}
    </>
  )

  const className = cn(titlebarButtonClass, 'bg-transparent select-none', item.className)

  const run = (event: MouseEvent) => {
    if (item.to) {
      navigate(item.to)
    }

    item.onSelect?.({ shiftKey: event.shiftKey })
  }

  if (item.href) {
    return (
      <Tip label={tooltipLabel}>
        <Button asChild className={className} size="icon-titlebar" variant="ghost">
          <a
            aria-label={String(item.title ?? item.label ?? item.id)}
            href={item.href}
            onPointerDown={event => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
          >
            {content}
          </a>
        </Button>
      </Tip>
    )
  }

  if (hasMenu) {
    return (
      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        <Tip label={tooltipLabel}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={String(item.title ?? item.label ?? item.id)}
              className={className}
              disabled={item.disabled}
              onClick={event => {
                if (item.to || item.onSelect) {
                  run(event)
                }
              }}
              onPointerDown={event => event.stopPropagation()}
              size="icon-titlebar"
              type="button"
              variant="ghost"
            >
              {content}
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align={item.menuAlign ?? 'end'} className={item.menuClassName}>
          {menuContent}
          {item.menuItems?.map(entry => (
            <DropdownMenuItem
              disabled={entry.disabled}
              key={entry.id}
              onSelect={event => {
                event.preventDefault()

                if (entry.to) {
                  navigate(entry.to)
                }

                entry.onSelect?.()
                setMenuOpen(false)
              }}
            >
              {entry.icon}
              <span className="truncate">{entry.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Tip label={tooltipLabel}>
      <Button
        aria-label={String(item.title ?? item.label ?? item.id)}
        className={className}
        disabled={item.disabled}
        onClick={run}
        onPointerDown={event => event.stopPropagation()}
        size="icon-titlebar"
        type="button"
        variant="ghost"
      >
        {content}
      </Button>
    </Tip>
  )
}

function TitlebarToolButton({ navigate, tool }: { navigate: ReturnType<typeof useNavigate>; tool: TitlebarTool }) {
  // Titlebar actions never show an active background — state reads from the
  // icon itself (e.g. the mute/unmute glyph). aria-pressed still carries it
  // for a11y.
  const className = cn(titlebarButtonClass, 'bg-transparent select-none', tool.className)

  const tooltipLabel = tool.actionId ? (
    <TipKeybindLabel actionId={tool.actionId} text={tool.title ?? tool.label} />
  ) : (
    (tool.title ?? tool.label)
  )

  if (tool.href) {
    return (
      <Tip label={tooltipLabel}>
        <Button asChild className={className} size="icon-titlebar" variant="ghost">
          <a
            aria-label={tool.label}
            href={tool.href}
            onPointerDown={event => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
          >
            {tool.icon}
          </a>
        </Button>
      </Tip>
    )
  }

  return (
    <Tip label={tooltipLabel}>
      <Button
        aria-label={tool.label}
        aria-pressed={tool.active ?? undefined}
        className={className}
        disabled={tool.disabled}
        onClick={event => {
          if (tool.to) {
            navigate(tool.to)
          }

          tool.onSelect?.(event)
        }}
        onPointerDown={event => event.stopPropagation()}
        size="icon-titlebar"
        type="button"
        variant="ghost"
      >
        {tool.icon}
      </Button>
    </Tip>
  )
}
