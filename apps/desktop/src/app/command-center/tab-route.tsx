import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type ReactNode, useContext, useMemo } from 'react'
import {
  createPath,
  UNSAFE_LocationContext as LocationContext,
  UNSAFE_NavigationContext as NavigationContext,
  NavigationType,
  type Navigator,
  parsePath
} from 'react-router'

import { readJson, writeJson } from '@/lib/storage'
import { openRouteTile } from '@/store/route-tiles'

import { COMMAND_CENTER_ROUTE, routePathname } from '../routes'

const STORAGE_KEY = 'hermes.desktop.commandCenterTabRoute.v1'
const remembered = readJson<unknown>(STORAGE_KEY)
export const $commandCenterTabRoute = atom(
  typeof remembered === 'string' && routePathname(remembered) === COMMAND_CENTER_ROUTE
    ? remembered
    : COMMAND_CENTER_ROUTE
)

function setCommandCenterTabRoute(to: string) {
  $commandCenterTabRoute.set(to)
  writeJson(STORAGE_KEY, to)
}

/** One Command Center tab, with its own section state, not the chat URL. */
export function openCommandCenterTab(to = COMMAND_CENTER_ROUTE) {
  if (to !== COMMAND_CENTER_ROUTE) {
    setCommandCenterTabRoute(to)
  }

  openRouteTile(COMMAND_CENTER_ROUTE, 'center')
}

/** Scope Command Center router hooks to the closeable tab. */
export function CommandCenterTabRoute({ children }: { children: ReactNode }) {
  const target = useStore($commandCenterTabRoute)
  const parent = useContext(NavigationContext)

  const location = useMemo(
    () => ({
      pathname: COMMAND_CENTER_ROUTE,
      search: '',
      hash: '',
      ...parsePath(target),
      state: null,
      key: 'command-center-tab'
    }),
    [target]
  )

  const navigation = useMemo(() => {
    const push: Navigator['push'] = (to, state, options) => {
      const path = typeof to === 'string' ? to : createPath(to)

      if (routePathname(path) === COMMAND_CENTER_ROUTE) {
        setCommandCenterTabRoute(path)
      } else {
        parent.navigator.push(to, state, options)
      }
    }

    const replace: Navigator['replace'] = (to, state, options) => {
      const path = typeof to === 'string' ? to : createPath(to)

      if (routePathname(path) === COMMAND_CENTER_ROUTE) {
        setCommandCenterTabRoute(path)
      } else {
        parent.navigator.replace(to, state, options)
      }
    }

    return { ...parent, navigator: { ...parent.navigator, push, replace } }
  }, [parent])

  return (
    <NavigationContext.Provider value={navigation}>
      <LocationContext.Provider value={{ location, navigationType: NavigationType.Replace }}>
        {children}
      </LocationContext.Provider>
    </NavigationContext.Provider>
  )
}
