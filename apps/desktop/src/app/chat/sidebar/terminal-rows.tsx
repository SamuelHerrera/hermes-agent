import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import {
  $focusedTerminalId,
  $terminalNavigation,
  type TerminalNavigationEntry
} from '@/app/right-sidebar/terminal/navigation'
import { closeTerminal, selectTerminal, type TerminalEntry } from '@/app/right-sidebar/terminal/terminals'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { TreeStem } from '@/components/ui/tree-stem'
import type { SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { $projectTree, projectIdForCwd } from '@/store/projects'

import { SidebarRowBody, SidebarRowLabel, SidebarRowLead, SidebarRowNest, SidebarRowShell } from './chrome'
import { NO_PROJECT_ID, type SidebarProjectTree } from './projects/workspace-groups'

export function terminalProjectId(terminal: TerminalEntry, projects: SidebarProjectTree[]): string {
  // A project can be adopted/renamed after terminal creation. Fall back to its
  // original cwd if the recorded synthetic id is no longer in the tree.
  if (terminal.projectId === NO_PROJECT_ID || projects.some(project => project.id === terminal.projectId)) {
    return terminal.projectId!
  }

  return projectIdForCwd(terminal.cwd, projects) ?? NO_PROJECT_ID
}

export function useProjectTerminals(project: SidebarProjectTree): readonly TerminalEntry[] {
  const terminals = useStore($terminalNavigation)
  const projects = useStore($projectTree)
  const profile = useStore($activeGatewayProfile)

  return terminals.filter(
    terminal =>
      terminal.kind === 'user' &&
      normalizeProfileKey(terminal.profile) === normalizeProfileKey(profile) &&
      terminalProjectId(terminal, projects) === project.id
  )
}

export function useTerminalProjectTree(projects: SidebarProjectTree[]): SidebarProjectTree[] {
  const terminals = useStore($terminalNavigation)
  const profile = useStore($activeGatewayProfile)
  const { t } = useI18n()

  return useMemo(() => {
    if (
      projects.some(project => project.isNoProject) ||
      !terminals.some(
        terminal =>
          terminal.kind === 'user' &&
          normalizeProfileKey(terminal.profile) === normalizeProfileKey(profile) &&
          terminalProjectId(terminal, projects) === NO_PROJECT_ID
      )
    ) {
      return projects
    }

    return [
      { id: NO_PROJECT_ID, label: t.sidebar.projects.home, path: null, isNoProject: true, repos: [], sessionCount: 0 },
      ...projects
    ]
  }, [projects, terminals, profile, t.sidebar.projects.home])
}

export function TerminalSidebarRows({ terminals }: { terminals: readonly TerminalEntry[] }) {
  return (
    <>
      {terminals.map(terminal => (
        <TerminalSidebarRow key={terminal.id} terminal={terminal} />
      ))}
    </>
  )
}

function TerminalSidebarRow({ terminal, branchStem }: { terminal: TerminalEntry; branchStem?: string }) {
  const { t } = useI18n()
  const selected = useStore($focusedTerminalId) === terminal.id

  return (
    <SidebarRowShell
      actions={
        <Button
          aria-label={`${t.common.delete}: ${terminal.title}`}
          onClick={() => closeTerminal(terminal.id)}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="trash" size="0.75rem" />
        </Button>
      }
      actionsClassName="opacity-0 group-hover/terminal:opacity-100 group-focus-within/terminal:opacity-100"
      className={cn('group/terminal row-hover relative', selected && 'bg-(--ui-row-active-background)')}
      data-sidebar-terminal={terminal.id}
    >
      <Tip label={[terminal.title, terminal.restoreCwd || terminal.cwd].filter(Boolean).join(' — ')}>
        <SidebarRowBody
          aria-pressed={selected}
          branch={Boolean(branchStem)}
          className="z-0 pr-2 py-1"
          onClick={() => selectTerminal(terminal.id)}
        >
          <SidebarRowLead branch={Boolean(branchStem)}>
            {branchStem ? (
              <TreeStem>{branchStem}</TreeStem>
            ) : (
              <Codicon name={terminal.kind === 'agent' ? 'output' : 'terminal'} size="0.875rem" />
            )}
          </SidebarRowLead>
          {branchStem ? <Codicon name="output" size="0.875rem" /> : null}
          <SidebarRowLabel className="group-hover/terminal:text-foreground">{terminal.title}</SidebarRowLabel>
        </SidebarRowBody>
      </Tip>
    </SidebarRowShell>
  )
}

export function SessionTerminalRows({
  session,
  hasFollowingBranches = false
}: {
  session: SessionInfo
  hasFollowingBranches?: boolean
}) {
  const children = useSessionTerminalChildren(session)

  return children.length ? (
    <SidebarRowNest className="pl-0" data-session-terminals={session.id}>
      {children.map((terminal, index) => (
        <TerminalSidebarRow
          branchStem={index === children.length - 1 && !hasFollowingBranches ? '└─ ' : '├─ '}
          key={terminal.id}
          terminal={terminal}
        />
      ))}
    </SidebarRowNest>
  ) : null
}

export function useSessionTerminalChildren(session: SessionInfo): readonly TerminalNavigationEntry[] {
  const terminals = useStore($terminalNavigation)

  return terminals.filter(terminal => {
    if (terminal.kind !== 'agent' || !terminal.ownerSessionId) {
      return false
    }

    return (
      normalizeProfileKey(terminal.profile) === normalizeProfileKey(session.profile) &&
      terminal.ownerAliases.includes(session.id)
    )
  })
}
