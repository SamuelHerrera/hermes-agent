import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useRef } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import type { SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $activeGatewayProfile } from '@/store/profile'
import { $homeProjectAppearances, homeProjectAppearanceForProfile } from '@/store/projects'

import {
  SIDEBAR_LEAD_ICON_SIZE,
  SidebarGroupRow,
  SidebarRowBody,
  SidebarRowGrab,
  SidebarRowLabel,
  SidebarRowLead,
  SidebarRowLeadGlyph,
  SidebarRowLink,
  SidebarRowNest,
  SidebarRowShell
} from '../chrome'

import { latestProjectSessions, PROJECT_OVERVIEW_SESSION_LIMIT, useWorkspaceNodeOpen } from './model'
import { ProjectIconGlyph } from './project-appearance'
import { ProjectContextMenu, ProjectMenu } from './project-menu'
import type { SidebarProjectTree } from './workspace-groups'
import { StartWorkButton, WorkspaceAddButton } from './workspace-header'

// A bare color dot, image/icon glyph, or auto-discovered project favicon. User
// picks are stored in `icon`; null means "fall back to favicon/default".
export function projectIcon({ color, icon, isNoProject, path }: SidebarProjectTree) {
  return (
    <SidebarRowLeadGlyph className="group-hover/workspace:text-foreground" style={color && icon ? { color } : undefined}>
      <ProjectIconGlyph
        color={color}
        icon={icon}
        isNoProject={isNoProject}
        path={path}
        size="1rem"
      />
    </SidebarRowLeadGlyph>
  )
}

export function ProjectBackRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <SidebarRowShell>
      <SidebarRowBody
        className="group/back w-full text-(--ui-text-tertiary) opacity-40 hover:text-foreground"
        onClick={onClick}
      >
        <SidebarRowLead>
          <SidebarRowLeadGlyph>
            <Codicon name="arrow-left" size={SIDEBAR_LEAD_ICON_SIZE} />
          </SidebarRowLeadGlyph>
        </SidebarRowLead>
        <SidebarRowLabel className="text-xs underline-offset-4 group-hover/back:underline">{label}</SidebarRowLabel>
      </SidebarRowBody>
    </SidebarRowShell>
  )
}

function ProjectSummaryCount({
  count,
  dataAttr,
  icon,
  label,
  spinning = false
}: {
  count: number
  dataAttr: 'archived' | 'chats' | 'children' | 'running'
  icon: string
  label: string
  spinning?: boolean
}) {
  const countAttrs = {
    ...(dataAttr === 'archived' ? { 'data-project-archived-count': true } : {}),
    ...(dataAttr === 'chats' ? { 'data-project-chat-count': true, 'data-project-open-count': true } : {}),
    ...(dataAttr === 'children' ? { 'data-project-child-count': true } : {}),
    ...(dataAttr === 'running' ? { 'data-project-running-count': true } : {})
  }

  return (
    <Tip label={label}>
      <span
        aria-label={label}
        className="flex items-center gap-1 tabular-nums"
        data-project-summary-count
        data-project-summary-kind={dataAttr}
        {...countAttrs}
      >
        <Codicon name={icon} size="0.75rem" spinning={spinning} />
        <span>{count}</span>
      </span>
    </Tip>
  )
}

function projectCounts(project: SidebarProjectTree) {
  const totalActiveCount = project.sessionCount ?? 0
  const childCount = project.childSessionCount ?? 0

  return {
    archivedCount: project.archivedSessionCount ?? 0,
    chatCount: project.chatSessionCount ?? Math.max(0, totalActiveCount - childCount),
    childCount,
    runningCount: project.runningSessionCount ?? 0
  }
}

function ProjectSummaryMeta({ project }: { project: SidebarProjectTree }) {
  const { archivedCount, chatCount, childCount, runningCount } = projectCounts(project)

  return (
    <span className="flex items-center gap-2 text-[0.625rem] leading-none text-(--ui-text-tertiary)">
      {runningCount > 0 && (
        <ProjectSummaryCount
          count={runningCount}
          dataAttr="running"
          icon="sync"
          label={`${runningCount} running chat${runningCount === 1 ? '' : 's'}`}
          spinning
        />
      )}
      <ProjectSummaryCount
        count={chatCount}
        dataAttr="chats"
        icon="comment-discussion"
        label={`${chatCount} chat${chatCount === 1 ? '' : 's'}`}
      />
      {childCount > 0 && (
        <ProjectSummaryCount
          count={childCount}
          dataAttr="children"
          icon="robot"
          label={`${childCount} child/subagent chat${childCount === 1 ? '' : 's'}`}
        />
      )}
      <ProjectSummaryCount
        count={archivedCount}
        dataAttr="archived"
        icon="archive"
        label={`${archivedCount} archived chat${archivedCount === 1 ? '' : 's'}`}
      />
    </span>
  )
}

interface ProjectOverviewRowProps {
  project: SidebarProjectTree
  onEnter?: (id: string) => void
  onNewSession?: (path: null | string) => void
  renderRows?: (sessions: SessionInfo[]) => React.ReactNode
  activeProjectId?: null | string
  previewSessions?: SessionInfo[]
  reorderable?: boolean
  dragging?: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
  ref?: React.Ref<HTMLDivElement>
  style?: React.CSSProperties
}

export function ProjectDetailHeaderRow({
  activeProjectId,
  onNewSession,
  project
}: {
  activeProjectId?: null | string
  onNewSession?: (path: null | string) => void
  project: SidebarProjectTree
}) {
  const { t } = useI18n()
  const s = t.sidebar
  const isActive = project.id === activeProjectId
  const homeAppearances = useStore($homeProjectAppearances)
  const activeGatewayProfile = useStore($activeGatewayProfile)

  const appearanceProject = project.isNoProject
    ? { ...project, ...homeProjectAppearanceForProfile(activeGatewayProfile, homeAppearances) }
    : project

  const projectPath = project.path ?? project.repos.find(repo => repo.path)?.path ?? null
  const rowRef = useRef<HTMLDivElement>(null)

  return (
    <div data-sessions-project={project.id} data-sessions-project-detail-header>
      <ProjectContextMenu isActive={isActive} project={appearanceProject}>
        <SidebarGroupRow
          actions={
            <>
              {projectPath && <StartWorkButton repoPath={projectPath} />}
              {onNewSession && (
                <WorkspaceAddButton label={s.newSessionIn(project.label)} onClick={() => onNewSession(projectPath)} />
              )}
              {!project.isNoProject && <ProjectMenu anchorRef={rowRef} isActive={isActive} project={appearanceProject} scoped />}
            </>
          }
          className="hover:bg-(--ui-control-hover-background) hover:text-foreground hover:transition-none"
          label={<SidebarRowLabel className="text-[0.8125rem] text-foreground">{project.label}</SidebarRowLabel>}
          lead={<SidebarRowLead className="size-4">{projectIcon(appearanceProject)}</SidebarRowLead>}
          ref={rowRef}
          secondaryMeta={<ProjectSummaryMeta project={project} />}
          totals={{ costUsd: project.totalCostUsd ?? 0, tokens: project.totalTokens ?? 0 }}
        />
      </ProjectContextMenu>
    </div>
  )
}

export function ProjectOverviewRow({
  project,
  onEnter,
  onNewSession,
  renderRows,
  activeProjectId,
  previewSessions,
  reorderable = false,
  dragging = false,
  dragHandleProps,
  ref,
  style
}: ProjectOverviewRowProps) {
  const { t } = useI18n()
  const s = t.sidebar
  const isActive = project.id === activeProjectId
  const [open, toggleOpen] = useWorkspaceNodeOpen(project.id)
  const homeAppearances = useStore($homeProjectAppearances)
  const activeGatewayProfile = useStore($activeGatewayProfile)

  const appearanceProject = project.isNoProject
    ? { ...project, ...homeProjectAppearanceForProfile(activeGatewayProfile, homeAppearances) }
    : project

  // The appearance popover anchors here (the full row) so it opens flush with
  // the sidebar's content edge regardless of which side the sidebar is on.
  const rowRef = useRef<HTMLDivElement>(null)
  const fetched = previewSessions ?? []

  const preview = renderRows
    ? fetched.length
      ? fetched
      : latestProjectSessions(project, PROJECT_OVERVIEW_SESSION_LIMIT)
    : []

  // A collapsed project means hidden content, even for active work. The global
  // sidebar/session status surfaces still show running state elsewhere; this
  // disclosure only controls whether preview rows are shown under the project.
  const visiblePreview = open ? preview : []

  const lead = reorderable ? (
    <SidebarRowGrab
      ariaLabel={s.projects.reorder(project.label)}
      dragging={dragging}
      dragHandleProps={dragHandleProps}
      leadClassName="size-4 overflow-visible"
    >
      {projectIcon(appearanceProject)}
    </SidebarRowGrab>
  ) : (
    <SidebarRowLead className="size-4">{projectIcon(appearanceProject)}</SidebarRowLead>
  )

  const shell = (
    <SidebarGroupRow
      actions={
        <>
          {/* Home is a bucket, not a record, so its menu omits rename/delete,
              but it can still start sessions and carry local appearance. */}
          {onNewSession && (
            <WorkspaceAddButton label={s.newSessionIn(project.label)} onClick={() => onNewSession(project.path)} />
          )}
          <ProjectMenu anchorRef={rowRef} isActive={isActive} project={appearanceProject} />
        </>
      }
      className={cn(
        'hover:bg-(--ui-control-hover-background) hover:text-foreground hover:transition-none',
        dragging && 'cursor-grabbing bg-(--ui-sidebar-surface-background)'
      )}
      label={
        <SidebarRowLink
          aria-label={s.projects.enter(project.label)}
          labelClassName={cn('group-hover/workspace:text-foreground', isActive && 'text-foreground')}
          onClick={() => onEnter?.(project.id)}
        >
          {project.label}
        </SidebarRowLink>
      }
      lead={lead}
      secondaryMeta={<ProjectSummaryMeta project={project} />}
      // The label is grab surface too, not just the lead's grabber — same
      // listeners, minus the controls that keep their own gestures. A project
      // row has no rival drag (its title navigates on CLICK), so the sortable
      // owns the press outright.
      {...dragHandleProps}
      onPointerDown={event => {
        if ((event.target as HTMLElement).closest('[data-reorder-handle], [data-row-actions]')) {
          return
        }

        dragHandleProps?.onPointerDown?.(event)
      }}
      ref={rowRef}
      toggle={
        preview.length > 0
          ? { ariaLabel: s.projects.toggle(project.label, !open), onToggle: toggleOpen, open }
          : undefined
      }
      totals={{ costUsd: project.totalCostUsd ?? 0, tokens: project.totalTokens ?? 0 }}
    />
  )

  return (
    // Tag each project sibling with its id so a custom skin can target one
    // project in the overview — the parallel to the entered-project wrapper's
    // `data-sessions-project` (index.tsx), which only fires once you've drilled
    // in. Here it's present on every row of the list.
    <div className={cn(dragging && 'relative z-10')} data-sessions-project={project.id} ref={ref} style={style}>
      <ProjectContextMenu isActive={isActive} project={appearanceProject}>
        {shell}
      </ProjectContextMenu>
      {visiblePreview.length > 0 && <SidebarRowNest>{renderRows?.(visiblePreview)}</SidebarRowNest>}
    </div>
  )
}
