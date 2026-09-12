import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { type CommandCenterSection } from '@/app/command-center'
import {
  AGENTS_ROUTE,
  appViewForPath,
  COMMAND_CENTER_ROUTE,
  isOverlayView,
  NEW_CHAT_ROUTE,
  STARMAP_ROUTE
} from '@/app/routes'
import { openSettingsTab } from '@/app/settings/tab-route'
import { openRouteTile } from '@/store/route-tiles'

const SECTIONS = ['sessions', 'system', 'usage'] as const

export function useOverlayRouting() {
  const location = useLocation()
  const navigate = useNavigate()

  const currentView = appViewForPath(location.pathname)
  const settingsOpen = currentView === 'settings'
  const commandCenterOpen = currentView === 'command-center'
  const agentsOpen = currentView === 'agents'
  const starmapOpen = currentView === 'starmap'
  const cronOpen = currentView === 'cron'
  const profilesOpen = currentView === 'profiles'
  const chatOpen = currentView === 'chat'
  const overlayOpen = isOverlayView(currentView)

  // Overlay routes and Settings hand-offs stash the underlying path
  // so closing them returns there instead of bouncing to /.
  const returnPathRef = useRef(NEW_CHAT_ROUTE)
  const settingsTargetRef = useRef<string | null>(null)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (!overlayOpen && !settingsOpen) {
      returnPathRef.current = `${location.pathname}${location.search}${location.hash}`
    }
  }, [location.hash, location.pathname, location.search, overlayOpen, settingsOpen])

  // Every entry point (gear, shortcut, palette, deep link) opens the same tab.
  // Settings owns its own section params. Use an effect so the parent router's
  // history subscription is ready on cold-start deep links too.
  // eslint-disable-next-line no-restricted-syntax -- one-shot router hand-off, not an atom mirror
  useEffect(() => {
    if (settingsOpen) {
      settingsTargetRef.current = `${location.pathname}${location.search}${location.hash}`
      navigate(returnPathRef.current, { replace: true })
    } else if (settingsTargetRef.current) {
      // Front the tab AFTER the shell has restored/synced its underlying page.
      // Otherwise returning to a page such as /skills would front workspace
      // over the just-opened Settings tab.
      const target = settingsTargetRef.current
      settingsTargetRef.current = null
      openSettingsTab(target)
    }
  }, [location.hash, location.pathname, location.search, navigate, settingsOpen])

  const commandCenterInitialSection = useMemo<CommandCenterSection | undefined>(
    () => SECTIONS.find(value => value === new URLSearchParams(location.search).get('section')),
    [location.search]
  )

  const openCommandCenterSection = useCallback(
    (section: CommandCenterSection) => navigate(`${COMMAND_CENTER_ROUTE}?section=${section}`),
    [navigate]
  )

  const resetOverlayReturnRoute = useCallback(() => {
    returnPathRef.current = NEW_CHAT_ROUTE
  }, [])

  const closeOverlayToPreviousRoute = useCallback(
    () => navigate(returnPathRef.current || NEW_CHAT_ROUTE, { replace: true }),
    [navigate]
  )

  const toggleCommandCenter = useCallback(() => {
    openRouteTile(COMMAND_CENTER_ROUTE, 'center')
  }, [])

  const openAgents = useCallback(() => navigate(AGENTS_ROUTE), [navigate])
  const openStarmap = useCallback(() => navigate(STARMAP_ROUTE), [navigate])

  return {
    agentsOpen,
    chatOpen,
    closeOverlayToPreviousRoute,
    commandCenterInitialSection,
    commandCenterOpen,
    cronOpen,
    currentView,
    openAgents,
    openCommandCenterSection,
    openStarmap,
    profilesOpen,
    resetOverlayReturnRoute,
    starmapOpen,
    toggleCommandCenter
  }
}
