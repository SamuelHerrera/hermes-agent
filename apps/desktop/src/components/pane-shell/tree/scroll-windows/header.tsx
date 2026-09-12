import { useStore } from '@nanostores/react'
import type { ComponentProps } from 'react'

import { $terminals } from '@/app/right-sidebar/terminal/terminals'
import { $projectTree, projectColorForCwd } from '@/store/projects'
import { $currentCwd, $selectedStoredSessionId, $sessions, sessionMatchesStoredId } from '@/store/session'
import { $sessionColorById, sessionColorFor } from '@/store/session-color'
import { $sessionTiles } from '@/store/session-states'

interface ScrollWindowHeaderProps extends ComponentProps<'div'> {
  windowId: string
}

/** Color belongs to the card's project, not whichever chat happens to be active.
 * Keep these subscriptions in the small header, away from the pane renderer. */
export function ScrollWindowHeader({ windowId, style, ...props }: ScrollWindowHeaderProps) {
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

  const color = terminal
    ? (projects.find(project => project.id === terminal.projectId)?.color ?? projectColorForCwd(terminal.cwd, projects))
    : ((session ? sessionColorFor(session) : storedId ? colors[storedId] : null) ??
      (paneCwd ? projectColorForCwd(paneCwd, projects) : null))

  return (
    <div
      {...props}
      data-scroll-window-project-color={color ?? undefined}
      style={{
        ...style,
        ...(color
          ? {
              backgroundColor: `color-mix(in srgb, ${color} 24%, var(--ui-sidebar-surface-background))`,
              borderBottomColor: `color-mix(in srgb, ${color} 60%, var(--ui-stroke-tertiary))`
            }
          : {})
      }}
    />
  )
}
