import { computed } from 'nanostores'

import { findGroup, findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree } from '@/components/pane-shell/tree/store'
import { desktopFsCacheKey } from '@/lib/desktop-fs'

import {
  $activeSessionId,
  $connection,
  $currentCwd,
  $selectedStoredSessionId,
  $sessions,
  idsShareLineage,
  sessionMatchesStoredId
} from './session'
import { $sessionStates, $sessionTiles } from './session-states'

const TILE_PANE_PREFIX = 'session-tile:'

let lastChatPane = 'workspace'
let lastConnectionKey = ''

// Files is itself focusable. Retain the last chat while browsing its files,
// rather than falling back to the primary chat as soon as the user clicks a row.
const $filesChatPane = computed([$activeTreeGroup, $layoutTree, $connection], (groupId, tree, connection) => {
  const connectionKey = desktopFsCacheKey(connection)

  if (connectionKey !== lastConnectionKey || !tree || !findGroupOfPane(tree, lastChatPane)) {
    lastChatPane = 'workspace'
    lastConnectionKey = connectionKey
  }

  const active = groupId && tree ? findGroup(tree, groupId)?.active : undefined

  if (active === 'workspace' || active?.startsWith(TILE_PANE_PREFIX)) {
    lastChatPane = active
  }

  return lastChatPane
})

/** Workspace of the interacted chat, not the route-driven primary chat. */
export const $focusedCwd = computed(
  [$filesChatPane, $selectedStoredSessionId, $activeSessionId, $sessionTiles, $sessionStates, $sessions, $currentCwd],
  (pane, selectedId, primaryRuntime, tiles, states, sessions, primaryCwd) => {
    const focusedId = pane.startsWith(TILE_PANE_PREFIX) ? pane.slice(TILE_PANE_PREFIX.length) : selectedId

    const runtimeId =
      focusedId && focusedId !== selectedId
        ? tiles.find(tile => tile.storedSessionId === focusedId)?.runtimeId
        : primaryRuntime

    const state = runtimeId ? states[runtimeId] : undefined

    // A primary navigation can select B before A's runtime is replaced.
    // An empty live cwd is authoritative too (a detached chat).
    const liveBelongsToFocus = focusedId
      ? Boolean(state?.storedSessionId && idsShareLineage(focusedId, state.storedSessionId, sessions))
      : !state?.storedSessionId

    if (state && liveBelongsToFocus) {
      return state.cwd.trim()
    }

    return (focusedId ? sessions.find(row => sessionMatchesStoredId(row, focusedId))?.cwd : primaryCwd)?.trim() || ''
  }
)
