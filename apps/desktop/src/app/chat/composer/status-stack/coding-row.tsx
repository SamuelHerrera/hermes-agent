import { useStore } from '@nanostores/react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'

import { PrTag } from '@/app/chat/pr-tag'
import { StatusRow } from '@/components/chat/status-row'
import {
  type ActionItemSpec,
  ActionsContextMenu,
  ActionsMenu,
  type MenuKit,
  renderActionItem
} from '@/components/ui/actions-menu'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { CopyButton } from '@/components/ui/copy-button'
import { DiffCount } from '@/components/ui/diff-count'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { HermesGitBranch } from '@/global'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { openWorktreeDialog, registerRepoStatusCwd, repoStatusForCwd, repoWorktreesForCwd } from '@/store/coding-status'
import { notifyError } from '@/store/notifications'
import { $pullRequestsByBranch, branchPrKey, refreshPullRequests } from '@/store/pull-requests'
import { $projectTree, projectIdForCwd, projectRootCwd } from '@/store/projects'

import type { SidebarProjectTree } from '../../sidebar/projects/workspace-groups'

// Tiny uppercase section header, matching the composer "+" menu's labels.
const MENU_SECTION = 'text-[0.625rem] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)'

interface ProjectOption {
  id: string
  label: string
  path: string
  rank: number
  lastActive: number
  isAuto: boolean
}

const projectOptionPathKey = (path: string): string => path.replace(/[/\\]+$/, '')

function projectOptionRank(project: SidebarProjectTree): number {
  // 0 = open/has chats, 1 = remembered explicit project, 2 = auto-discovered.
  if ((project.sessionCount ?? 0) > 0 || (project.previewSessions?.length ?? 0) > 0 || (project.runningSessionCount ?? 0) > 0) {
    return 0
  }

  return project.isAuto ? 2 : 1
}

export function projectOptionsForComposer(projects: SidebarProjectTree[]): ProjectOption[] {
  const byPath = new Map<string, ProjectOption>()

  for (const project of projects) {
    if (project.isNoProject) {
      continue
    }

    const path = projectRootCwd(project)
    const key = projectOptionPathKey(path)

    if (!key) {
      continue
    }

    const option: ProjectOption = {
      id: project.id,
      isAuto: Boolean(project.isAuto),
      label: project.label,
      lastActive: project.lastActive ?? 0,
      path,
      rank: projectOptionRank(project)
    }
    const existing = byPath.get(key)

    // Consolidate duplicate explicit/auto or local/upstream entries that point
    // at the same working root. Keep the most useful presentation: open beats
    // remembered beats discovered; within a tier, explicit project labels beat
    // auto rows, then recency/name settle ties.
    if (
      !existing ||
      option.rank < existing.rank ||
      (option.rank === existing.rank && !option.isAuto && existing.isAuto) ||
      (option.rank === existing.rank && option.lastActive > existing.lastActive) ||
      (option.rank === existing.rank &&
        option.lastActive === existing.lastActive &&
        option.label.localeCompare(existing.label, undefined, { sensitivity: 'base' }) < 0)
    ) {
      byPath.set(key, option)
    }
  }

  return [...byPath.values()].sort(
    (a, b) =>
      a.rank - b.rank ||
      b.lastActive - a.lastActive ||
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  )
}

interface CodingStatusRowProps {
  /** Branch the current draft off into a fresh worktree + session, based on
   *  `base` (a branch name; omitted = current HEAD). The composer owns the
   *  draft, so it supplies the orchestration; the row just collects the new
   *  branch name + base. Omitted (e.g. remote backend) hides the affordance. */
  onBranchOff?: (branch: string, base?: string) => Promise<void>
  /** Check an existing branch out into a fresh worktree + session (no new
   *  branch). Drives the dialog's "convert a branch" picker. */
  onConvertBranch?: (branch: string, path?: null | string, isDefault?: boolean) => Promise<void>
  /** List the repo's local branches for the "convert a branch" picker. */
  onListBranches?: () => Promise<HermesGitBranch[]>
  /** Jump into an existing worktree (open a fresh session anchored there). */
  onOpenWorktree?: (path: string) => void
  /** Switch the current repo checkout to another branch. */
  onSwitchBranch?: (branch: string) => Promise<void>
  /** Repo root path for the worktree dialog. */
  repoPath?: null | string
}

/**
 * The always-on coding-context row, the BASE of the composer status stack:
 * current branch, dirty summary (+/-), and ahead/behind. A touch more prominent
 * than the per-turn rows above it (larger branch label, accent glyph), and the
 * workspace context. Hidden when the active session isn't in a
 * local git repo (the probe returns null).
 */
export const CodingStatusRow = memo(function CodingStatusRow({
  onBranchOff,
  onConvertBranch,
  onListBranches,
  onOpenWorktree,
  onSwitchBranch,
  repoPath
}: CodingStatusRowProps) {
  const { t } = useI18n()
  const s = t.statusStack.coding
  const p = t.sidebar.projects
  const fileMenu = t.fileMenu
  const resolvedRepoPath = repoPath?.trim() || undefined
  // This surface's OWN worktree, always — never the primary's. The row used to
  // fall back to the global `$repoStatus` for a blank repoPath, which painted
  // the main pane's branch/± onto a tile whose cwd hadn't resolved yet. That
  // fallback bought nothing (the primary's computed is keyed to `$currentCwd`,
  // which is blank in exactly the same case) and cost a wrong-tree rail.
  const status = useStore(repoStatusForCwd(resolvedRepoPath))
  const worktrees = useStore(repoWorktreesForCwd(resolvedRepoPath))
  const projectTree = useStore($projectTree)
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [branches, setBranches] = useState<HermesGitBranch[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)

  // While mounted, keep this worktree in the coding-status refresh set so the
  // turn-settle / tool-complete / focus edges re-probe it too (tiles otherwise
  // only refreshed when the MAIN cwd probe happened to cover them).
  useEffect(() => registerRepoStatusCwd(resolvedRepoPath), [resolvedRepoPath])

  // The branch's PR, so the rail links to it instead of leaving you to go find
  // it. One `gh` lookup for this one branch, TTL-cached in the store and shared
  // with the sidebar's badges.
  const prBranch = status?.detached ? null : status?.branch || null

  useEffect(() => {
    if (resolvedRepoPath && prBranch) {
      void refreshPullRequests({ [resolvedRepoPath]: [prBranch] })
    }
  }, [resolvedRepoPath, prBranch])

  const pr =
    useStore($pullRequestsByBranch)[resolvedRepoPath && prBranch ? branchPrKey(resolvedRepoPath, prBranch) : '']

  const loadBranches = useCallback(async () => {
    if (!onListBranches) {
      return
    }

    setBranchesLoading(true)

    try {
      setBranches(await onListBranches())
    } catch {
      setBranches([])
    } finally {
      setBranchesLoading(false)
    }
  }, [onListBranches])

  const switchToBranch = async (branch: string) => {
    if (!onSwitchBranch) {
      return
    }

    try {
      await onSwitchBranch(branch)
    } catch (err) {
      notifyError(err, s.switchFailed(branch))
    }
  }

  // useKeybinds now handles the ⌘⇧B hotkey globally, through
  // openWorktreeDialog. One dialog is mounted in the sidebar, so N mounted
  // rails can no longer each open their own copy. The menu items below only
  // publish the intent. They pin the repo of THIS rail, so the kebab of a tile
  // targets the worktree of that tile.
  const startBranch = (base: string | undefined) => {
    void openWorktreeDialog({ base, repoPath: resolvedRepoPath })
  }

  if (!status) {
    return null
  }

  const branchLabel = status.detached ? s.detached : status.branch || s.noBranch
  const projectOptions = useMemo(() => projectOptionsForComposer(projectTree), [projectTree])
  const activeProjectId = resolvedRepoPath ? projectIdForCwd(resolvedRepoPath, projectTree) : null
  // The kebab offers branching off the trunk and/or the current branch. The
  // worktree-add bases the new branch on `base` (a branch name; undefined =
  // current HEAD). We dedupe so "on main" shows a single trunk entry, and fall
  // back to a plain off-HEAD branch when no trunk is detected.
  const current = status.detached ? null : status.branch
  const branchTargets: { base: string | undefined; label: string }[] = []

  // Current branch first (the 99% "branch off where I am"), then the trunk just
  // below it ("New branch from main"), deduped when they're the same.
  if (current) {
    branchTargets.push({ base: current, label: s.branchOffFrom(current) })
  }

  if (status.defaultBranch && status.defaultBranch !== current) {
    branchTargets.push({ base: status.defaultBranch, label: s.branchOffFrom(status.defaultBranch) })
  }

  if (branchTargets.length === 0) {
    branchTargets.push({ base: undefined, label: s.newBranch })
  }

  const switchTarget =
    onSwitchBranch && current && status.defaultBranch && status.defaultBranch !== current ? status.defaultBranch : null

  // Other worktrees to jump into — everything except the one we're already in
  // (matched by its checked-out branch) and the bare/main placeholder entry.
  const otherWorktrees = onOpenWorktree
    ? worktrees.filter(w => w.path && !w.detached && w.branch && w.branch !== current)
    : []

  const switchToExistingBranch = async (branch: HermesGitBranch) => {
    if (!onConvertBranch) {
      return
    }

    try {
      await onConvertBranch(branch.name, branch.worktreePath, branch.isDefault)
      setBranchPickerOpen(false)
    } catch (err) {
      notifyError(err, s.switchFailed(branch.name))
    }
  }

  const hasLineDelta = status.added > 0 || status.removed > 0
  // Untracked files carry no line delta vs HEAD, so surface them as a count when
  // they're the only change (otherwise +/- tells the story).
  const untrackedOnly = !hasLineDelta && status.untracked > 0

  // The branch actions, rendered identically by the kebab dropdown and the
  // row's right-click menu so the two never drift. `onBranchOff` gates the
  // whole menu (omitted = remote backend), matching the kebab.
  const renderBranchItems = (kit: MenuKit) => {
    const branchItems: ActionItemSpec[] = branchTargets.map(target => ({
      key: target.base ?? '__head__',
      label: <span className="truncate">{target.label}</span>,
      onSelect: () => startBranch(target.base)
    }))

    const worktreeItems: ActionItemSpec[] = otherWorktrees.map(worktree => ({
      key: worktree.path,
      label: <span className="truncate">{worktree.branch}</span>,
      onSelect: () => onOpenWorktree?.(worktree.path)
    }))

    return (
      <>
        <kit.Label className={MENU_SECTION}>{s.newBranch}</kit.Label>
        {branchItems.map(item => renderActionItem(kit, item))}
        {switchTarget &&
          renderActionItem(kit, {
            key: '__switch__',
            label: <span className="truncate">{s.switchTo(switchTarget)}</span>,
            onSelect: () => void switchToBranch(switchTarget)
          })}
        <kit.Separator />
        <kit.Label className={MENU_SECTION}>{s.worktrees}</kit.Label>
        {worktreeItems.map(item => renderActionItem(kit, item))}
        {/* Create a fresh worktree off the current HEAD (the generic "spin up a
            worktree here", mirroring the sidebar's + button). */}
        {renderActionItem(kit, {
          key: '__start__',
          label: <span className="truncate">{p.startWork}</span>,
          onSelect: () => startBranch(undefined)
        })}
        {onConvertBranch &&
          renderActionItem(kit, {
            key: '__convert__',
            label: <span className="truncate">{p.convertBranch}</span>,
            onSelect: () => startBranch(undefined)
          })}
      </>
    )
  }

  return (
    <>
      <ActionsContextMenu contentClassName="w-60" disabled={!onBranchOff} items={renderBranchItems}>
        <StatusRow
          // The base "where am I working" strip is part of the composer surface
          // itself, so it inherits the composer's width and clipped top radius.
          className="coding-status-bar min-h-7 rounded-t-[inherit] rounded-b-none border-b border-(--ui-stroke-tertiary) px-3.5 py-1.5 hover:bg-transparent"
          // Static branch glyph — never the loading spinner. This row only renders
          // once `status` exists, so a spinner here only ever fired on *refreshes*
          // of an already-loaded repo (window focus, turn settle), reading as an
          // annoying icon "blip" with no first-load value. Refreshes are silent.
          leading={
            <span className="flex size-3.5 items-center justify-center">
              <Codicon className="text-(--ui-green)" name="git-branch" size="0.8rem" />
            </span>
          }
        >
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {/* PR number first, right against the leading git glyph — the chip
                borrows that icon instead of carrying a second one of its own
                (`showIcon={false}`), so the row reads glyph → #number → branch. */}
            {pr && <PrTag pr={pr} showIcon={false} />}

            {/* Branch context doubles as the fast branch/worktree selector. */}
            {onListBranches && onConvertBranch ? (
              <Popover
                onOpenChange={next => {
                  if (next && branches.length === 0 && !branchesLoading) {
                    void loadBranches()
                  }

                  setBranchPickerOpen(next)
                }}
                open={branchPickerOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs font-normal text-muted-foreground/92 transition hover:bg-(--chrome-action-hover) hover:text-foreground data-[state=open]:bg-(--chrome-action-hover) data-[state=open]:text-foreground"
                    title={branchLabel}
                    type="button"
                  >
                    <span className="min-w-0 truncate">{branchLabel}</span>
                    <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="chevron-down" size="0.65rem" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-0" side="top" sideOffset={8}>
                  <Command filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
                    <CommandInput autoFocus placeholder={`Search ${branchLabel} branches`} />
                    <CommandList className="max-h-72">
                      <CommandEmpty>{branchesLoading ? p.branchesLoading : p.noBranches}</CommandEmpty>
                      <CommandGroup heading="Branches">
                        {branches.map(branch => (
                          <CommandItem
                            key={branch.name}
                            onSelect={() => void switchToExistingBranch(branch)}
                            value={`${branch.name} ${branch.worktreePath ?? ''}`}
                          >
                            <Codicon
                              className="shrink-0 text-(--ui-text-tertiary)"
                              name={branch.isRemote ? 'repo' : 'git-branch'}
                              size="0.8rem"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{branch.name}</div>
                              {branch.worktreePath ? (
                                <div className="truncate text-[0.65rem] text-(--ui-text-tertiary)">
                                  {displayPath(branch.worktreePath)}
                                </div>
                              ) : null}
                            </div>
                            {branch.name === current && (
                              <Codicon className="shrink-0 text-(--ui-accent)" name="check" size="0.8rem" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      <CommandGroup>
                        <CommandItem onSelect={() => startBranch(undefined)} value="create checkout new branch worktree">
                          <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="add" size="0.8rem" />
                          <span>Create and checkout new branch…</span>
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <span className="min-w-0 truncate text-xs font-normal text-muted-foreground/92" title={branchLabel}>
                {branchLabel}
              </span>
            )}

            {/* Worktree path + copy — plain muted text, not a chip. Always visible
                so the composer names both the branch and the folder it is running
                in without requiring hover. The path sizes to its content (the
                `flex-1` lives on the wrapper) so the glyph sits against the end
                of the text instead of drifting to the far edge of the row.
                `displayPath` collapses home → ~; the copy still takes the real
                absolute path, and it's the shared `CopyButton` so it confirms
                with the same inline checkmark as every other copy in the app. */}
            {resolvedRepoPath && (
              <div className="flex min-w-0 flex-1 items-center gap-0.5">
                {projectOptions.length > 1 && onOpenWorktree ? (
                  <Popover onOpenChange={setProjectPickerOpen} open={projectPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className="min-w-0 truncate rounded-md px-1 py-0.5 font-mono text-[0.62rem] leading-4 text-muted-foreground/50 transition hover:bg-(--chrome-action-hover) hover:text-foreground data-[state=open]:bg-(--chrome-action-hover) data-[state=open]:text-foreground"
                        data-slot="coding-status-cwd"
                        title={resolvedRepoPath}
                        type="button"
                      >
                        {displayPath(resolvedRepoPath)}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 p-0" side="top" sideOffset={8}>
                      <Command filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
                        <CommandInput autoFocus placeholder="Search projects" />
                        <CommandList className="max-h-72">
                          <CommandEmpty>{p.worktreeProjectNone}</CommandEmpty>
                          <CommandGroup>
                            {projectOptions.map(option => (
                              <CommandItem
                                key={option.path}
                                onSelect={() => {
                                  onOpenWorktree(option.path)
                                  setProjectPickerOpen(false)
                                }}
                                value={`${option.label} ${option.path}`}
                              >
                                <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="root-folder" size="0.8rem" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate">{option.label}</div>
                                  <div className="truncate text-[0.65rem] text-(--ui-text-tertiary)">{displayPath(option.path)}</div>
                                </div>
                                {option.id === activeProjectId && (
                                  <Codicon className="shrink-0 text-(--ui-accent)" name="check" size="0.8rem" />
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span
                    className="min-w-0 truncate font-mono text-[0.62rem] leading-4 text-muted-foreground/50"
                    data-slot="coding-status-cwd"
                  >
                    {displayPath(resolvedRepoPath)}
                  </span>
                )}
                <CopyButton
                  appearance="icon"
                  buttonSize="icon-xs"
                  className="size-4 shrink-0 text-muted-foreground/50 hover:text-foreground"
                  iconClassName="size-3"
                  label={fileMenu.copyPath}
                  side="top"
                  stopPropagation
                  text={resolvedRepoPath}
                />
              </div>
            )}

            {/* Branch actions kebab — same pattern as the session/worktree rows.
                ALWAYS laid out; only its opacity flips on hover/focus/open, so
                revealing it never reflows the row (no layout shift). pointer-events
                follow opacity so the invisible trigger isn't clickable at rest. */}
            {onBranchOff && (
              <ActionsMenu
                align="end"
                contentClassName="w-60"
                // The row sits at the bottom of the screen (above the composer),
                // so the menu opens upward.
                items={renderBranchItems}
                side="top"
              >
                <Button
                  aria-label={s.newBranch}
                  className="pointer-events-none size-4 shrink-0 text-muted-foreground/60 opacity-0 transition hover:text-foreground group-hover/status-row:pointer-events-auto group-hover/status-row:opacity-100 group-focus-within/status-row:pointer-events-auto group-focus-within/status-row:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
                  size="icon-xs"
                  variant="ghost"
                >
                  <Codicon name="kebab-vertical" size="0.8rem" />
                </Button>
              </ActionsMenu>
            )}
          </div>

          {/* Read-only working-tree and ahead/behind counts. */}
          {(status.ahead > 0 || status.behind > 0 || hasLineDelta || untrackedOnly) && (
            <span className="contents">
              {(status.ahead > 0 || status.behind > 0) && (
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[0.68rem] leading-4 text-muted-foreground/75 tabular-nums">
                  {status.ahead > 0 && (
                    <span className="flex items-center gap-0.5" title={s.ahead(status.ahead)}>
                      <span aria-hidden>↑</span>
                      {status.ahead}
                    </span>
                  )}
                  {status.behind > 0 && (
                    <span className="flex items-center gap-0.5" title={s.behind(status.behind)}>
                      <span aria-hidden>↓</span>
                      {status.behind}
                    </span>
                  )}
                </span>
              )}

              {hasLineDelta ? (
                <DiffCount
                  added={status.added}
                  className={`text-[0.72rem] leading-4 ${status.ahead === 0 && status.behind === 0 ? 'ml-auto' : ''}`}
                  removed={status.removed}
                />
              ) : untrackedOnly ? (
                <span
                  className={`shrink-0 text-[0.72rem] leading-4 text-amber-500/90 ${status.ahead === 0 && status.behind === 0 ? 'ml-auto' : ''}`}
                >
                  {s.changed(status.untracked)}
                </span>
              ) : null}
            </span>
          )}
        </StatusRow>
      </ActionsContextMenu>
    </>
  )
})
