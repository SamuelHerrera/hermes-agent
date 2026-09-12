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

import { routePathname, SETTINGS_ROUTE } from '../routes'

const STORAGE_KEY = 'hermes.desktop.settingsTabRoute.v1'
const remembered = readJson<unknown>(STORAGE_KEY)
export const $settingsTabRoute = atom(
  typeof remembered === 'string' && routePathname(remembered) === SETTINGS_ROUTE ? remembered : SETTINGS_ROUTE
)

function setSettingsTabRoute(to: string) {
  $settingsTabRoute.set(to)
  writeJson(STORAGE_KEY, to)
}

/** One Settings tab, with its own section/deep-link state, not the chat URL. */
export function openSettingsTab(to = SETTINGS_ROUTE) {
  if (to !== SETTINGS_ROUTE) {
    setSettingsTabRoute(to)
  }

  openRouteTile(SETTINGS_ROUTE, 'center')
}

/** Scope existing Settings router hooks without nesting a second Router.
 * Links outside Settings still use the application's navigator. */
export function SettingsTabRoute({ children }: { children: ReactNode }) {
  const target = useStore($settingsTabRoute)
  const parent = useContext(NavigationContext)

  const location = useMemo(
    () => ({
      pathname: SETTINGS_ROUTE,
      search: '',
      hash: '',
      ...parsePath(target),
      state: null,
      key: 'settings-tab'
    }),
    [target]
  )

  const navigation = useMemo(() => {
    const navigate: Navigator['push'] = (to, state, options) => {
      const path = typeof to === 'string' ? to : createPath(to)

      if (routePathname(path) === SETTINGS_ROUTE) {
        setSettingsTabRoute(path)
      } else {
        parent.navigator.push(to, state, options)
      }
    }

    const replace: Navigator['replace'] = (to, state, options) => {
      const path = typeof to === 'string' ? to : createPath(to)

      if (routePathname(path) === SETTINGS_ROUTE) {
        setSettingsTabRoute(path)
      } else {
        parent.navigator.replace(to, state, options)
      }
    }

    return { ...parent, navigator: { ...parent.navigator, push: navigate, replace } }
  }, [parent])

  return (
    <NavigationContext.Provider value={navigation}>
      <LocationContext.Provider value={{ location, navigationType: NavigationType.Replace }}>
        {children}
      </LocationContext.Provider>
    </NavigationContext.Provider>
  )
}
