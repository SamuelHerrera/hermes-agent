import { useStore } from '@nanostores/react'

import { $terminals } from '@/app/right-sidebar/terminal/terminals'
import { $projectTree, projectColorForCwd } from '@/store/projects'
import { $currentCwd, $selectedStoredSessionId, $sessions, sessionMatchesStoredId } from '@/store/session'
import { $sessionColorById, sessionColorFor } from '@/store/session-color'
import { $sessionTiles } from '@/store/session-states'

/** Shared identity for card headers and minimap boxes; never the foreground
 * project's color unless this is the primary workspace card itself. */
export function useScrollWindowColor(windowId: string) {
  const projects = useStore($projectTree)
  const sessions = useStore($sessions)
  const colors = useStore($sessionColorById)
  const selectedId = useStore($selectedStoredSessionId)
  const cwd = useStore($currentCwd)
  const tiles = useStore($sessionTiles)
  const terminals = useStore($terminals)
  const tile = tiles.find(item => `session-tile:${item.storedSessionId}` === windowId)
  const terminal = terminals.find(item => `terminal-instance:${item.id}` === windowId)
  const storedId = windowId === 'workspace' ? selectedId : tile?.storedSessionId
  const match = (session: (typeof sessions)[number]) => Boolean(storedId && sessionMatchesStoredId(session, storedId))

  const session =
    sessions.find(match) ??
    projects
      .flatMap(project => [
        ...project.repos.flatMap(repo => repo.groups.flatMap(group => group.sessions)),
        ...(project.previewSessions ?? [])
      ])
      .find(match)

  const paneCwd = windowId === 'workspace' ? cwd : (tile?.workspaceCwd ?? terminal?.cwd)

  return terminal
    ? (projects.find(project => project.id === terminal.projectId)?.color ?? projectColorForCwd(terminal.cwd, projects))
    : ((session ? sessionColorFor(session) : storedId ? colors[storedId] : null) ??
        (paneCwd ? projectColorForCwd(paneCwd, projects) : null))
}

export const scrollWindowColorBackground = (color: string) =>
  `color-mix(in srgb, ${color} 24%, var(--ui-sidebar-surface-background))`
