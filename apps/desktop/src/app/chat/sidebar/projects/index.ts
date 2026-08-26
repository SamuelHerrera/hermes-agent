// Public surface of the project/worktree sidebar, consumed by the sidebar root.
export { EnteredProjectContent } from './entered-content'
export {
  orderProjectsByIds,
  PROJECT_OVERVIEW_SESSION_LIMIT,
  PROJECT_PREVIEW_COUNT,
  projectTreeCwd,
  sortProjectsForOverview,
  useRepoWorktreeMap
} from './model'
export { ProjectBackRow, ProjectDetailHeaderRow, ProjectOverviewRow } from './overview-row'
export { ProjectMenu } from './project-menu'
export { SidebarWorkspaceGroup } from './workspace-group'
export {
  excludeProjectSessions,
  liveSessionProjectId,
  overlayLiveLanes,
  overlayLivePreviews,
  overlayProjectRunningCounts,
  sessionRecency,
  type SidebarProjectTree,
  type SidebarSessionGroup,
  type SidebarWorkspaceTree
} from './workspace-groups'
export { StartWorkButton } from './workspace-header'
