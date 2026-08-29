import { useStore } from '@nanostores/react'
import { memo } from 'react'
import type * as React from 'react'

import { PrTag } from '@/app/chat/pr-tag'
import { ProfileTag } from '@/app/chat/profile-tag'
import { startSessionDrag } from '@/app/chat/session-drag'
import { SubagentSessionIcon } from '@/app/chat/subagent-session-icon'
import { PlatformAvatar } from '@/app/messaging/platform-icon'
import { openSession } from '@/app/open-session'
import { formatMessageTimestamp } from '@/components/assistant-ui/thread/timestamp'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { OverflowTip, Tip } from '@/components/ui/tooltip'
import type { SessionInfo } from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { isSubagentSession, sessionTitle } from '@/lib/chat-runtime'
import { pathLeaf } from '@/lib/display-path'
import { compactNumber } from '@/lib/format'
import { triggerHaptic } from '@/lib/haptics'
import { middleClickHandlers } from '@/lib/middle-click'
import { displayModelName } from '@/lib/model-status-label'
import { sessionProjectLabel } from '@/lib/session-project-label'
import { handoffOriginSource, sessionSourceLabel } from '@/lib/session-source'
import { coarseElapsed } from '@/lib/time'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $sidebarRowMeta } from '@/store/layout'
import { normalizeProfileKey } from '@/store/profile'
import { $projects } from '@/store/projects'
import { $pullRequestsByBranch, sessionPrKey } from '@/store/pull-requests'
import { $sessionDotStateById, hasLiveTurn } from '@/store/session-dot-state'
import { promoteSessionTile } from '@/store/session-states'
import { sessionCostUsd } from '@/store/sidebar-archive'
import { $todoProgressBySession } from '@/store/todos'

import { SessionProjectDot, SessionStatusIcon } from '../session-status-dot'

import {
  SIDEBAR_ROW_CARD_MIN_H,
  SidebarRowBody,
  SidebarRowGrab,
  SidebarRowLabel,
  SidebarRowLead,
  SidebarRowLeadGlyph,
  SidebarRowShell
} from './chrome'
import { SessionActionsMenu, SessionContextMenu } from './session-actions-menu'
import { useProfilePrewarm } from './use-profile-prewarm'

interface SidebarSessionRowProps extends React.ComponentProps<'div'> {
  session: SessionInfo
  /** TUI-style tree stem for branched sessions (`└─ ` / `├─ `). */
  branchStem?: string
  /** This row owns visible child rows and can be collapsed. */
  hasBranchChildren?: boolean
  branchChildCount?: number
  branchCollapsed?: boolean
  onToggleBranch?: () => void
  isPinned: boolean
  isSelected: boolean
  onArchive: () => void
  onBranch?: () => void
  onDelete: () => void
  onPin: () => void
  onResume: () => void
  reorderable?: boolean
  dragging?: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
  /** Tag the row with its owning profile (initial chip + tooltip). Used by
   *  flat cross-profile lists — Pinned and search results in the All-profiles
   *  view — where no group header communicates ownership (#66003). */
  showProfile?: boolean
  /** Inbox-style card: workspace header, title + last-message preview, and a
   *  model · size footer. The flat recents list opts in via the filter menu;
   *  dense tree surfaces (projects, messaging, pins) keep the one-line row. */
  card?: boolean
}

const AGE_KEY = { day: 'ageDay', hour: 'ageHour', minute: 'ageMin' } as const

// Hover marquee (card title): measure the actual overflow on pointerenter and
// arm the CSS animation only when there is some — CSS can't detect overflow on
// its own, and animating a non-overflowing title would wiggle for nothing.
// Distance-proportional duration keeps the scroll speed constant across short
// and long overflows. State lives in DOM attributes, not React state: hover
// must not re-render a memoized row.
const MARQUEE_PX_PER_SECOND = 80

function armMarquee(event: React.PointerEvent<HTMLElement>) {
  const el = event.currentTarget
  const distance = el.scrollWidth - el.clientWidth

  if (distance > 2) {
    // The keyframes spend 65% of the cycle travelling (10%→75%); scale the
    // duration so the travel segment itself moves at the target speed.
    el.style.setProperty('--marquee-d', `${distance}px`)
    el.style.setProperty('--marquee-t', `${Math.max(1, distance / MARQUEE_PX_PER_SECOND / 0.65)}s`)
    el.dataset.marquee = 'true'
  }
}

function disarmMarquee(event: React.PointerEvent<HTMLElement>) {
  delete event.currentTarget.dataset.marquee
}

function formatAge(seconds: number, r: Translations['sidebar']['row']): string {
  const { unit, value } = coarseElapsed(Date.now() - seconds * 1000)

  // Under a minute reads as "now" — the sidebar never shows a seconds tick.
  return unit === 'second' ? r.ageNow : `${value}${r[AGE_KEY[unit]]}`
}

function SidebarSessionRowImpl({
  session,
  branchStem,
  branchChildCount = 0,
  hasBranchChildren = false,
  branchCollapsed = false,
  onToggleBranch,
  isPinned,
  isSelected,
  onArchive,
  onBranch,
  onDelete,
  onPin,
  onResume,
  reorderable = false,
  dragging = false,
  dragHandleProps,
  showProfile = false,
  card = false,
  className,
  style,
  ref,
  ...rest
}: SidebarSessionRowProps) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const { cancelPrewarm, startPrewarm } = useProfilePrewarm(session.profile)
  const title = sessionTitle(session)
  const timestamp = session.last_active || session.started_at
  const age = formatAge(timestamp, r)
  const timestampDate = new Date(timestamp * 1000)
  const absoluteAge = formatMessageTimestamp(timestampDate, t.assistant.thread)
  const handleLabel = `Reorder ${title}`
  // Opt-in row metadata from the sidebar's filter menu. Read from the store
  // rather than threaded as props: the subscription re-renders past the memo
  // below, and a toggle should repaint every row at once anyway.
  const rowMeta = useStore($sidebarRowMeta)
  // Pinned metadata occupies the actions slot and swaps out for the kebab on
  // hover, so the row reserves the same width either way and never reflows.
  const pinnedAge = rowMeta.includes('updated')
  // The default profile has no mark worth spending a row slot on — a chip on
  // every row that says "the normal one" is noise. Named profiles only.
  const hasProfileTag = normalizeProfileKey(session.profile) !== 'default'
  const pinnedProfile = hasProfileTag && rowMeta.includes('profile')
  // The branch's PR, if the row was asked to show one. A selector, not a plain
  // useStore: a repo's PRs land as a single map write, and only the rows on
  // those branches should repaint.
  const prKey = sessionPrKey(session)
  const pr = useStoreSelector($pullRequestsByBranch, prs => (rowMeta.includes('pr') && prKey ? prs[prKey] : undefined))
  const totalTokens = session.input_tokens + session.output_tokens
  const cost = sessionCostUsd(session)

  // Tokens, cost and age now live in a real metadata line instead of fighting
  // the title for the row's only line. Identity chips ride that same line so
  // the top row can stay: leading icon, title, then right-side action buttons.
  const figures = [
    rowMeta.includes('tokens') && totalTokens > 0 ? compactNumber(totalTokens) : null,
    // Sub-cent spend rounds to "$0.00", which reads as a bug rather than as a
    // cheap session — below a cent the row says nothing at all.
    rowMeta.includes('cost') && cost >= 0.01 ? `$${cost.toFixed(2)}` : null
  ].filter(Boolean) as string[]

  const showAge = pinnedAge || card
  const metadata: { key: string; node: React.ReactNode }[] = []

  if ((showProfile || pinnedProfile) && hasProfileTag) {
    metadata.push({ key: 'profile', node: <ProfileTag profile={session.profile} /> })
  }

  if (pr) {
    metadata.push({ key: 'pr', node: <PrTag pr={pr} /> })
  }

  const fullBranch = session.git_branch?.trim() ?? ''
  const branchName = fullBranch.split('/').filter(Boolean).at(-1) ?? ''

  if (branchName) {
    metadata.push({
      key: 'branch',
      node: (
        <Tip label={fullBranch} side="top">
          <span
            aria-label={`Branch ${fullBranch}`}
            className="pointer-events-auto block max-w-28 truncate"
            data-session-branch
          >
            {branchName}
          </span>
        </Tip>
      )
    })
  }

  figures.forEach((figure, index) => {
    metadata.push({ key: `figure-${index}`, node: <span className="whitespace-nowrap tabular-nums">{figure}</span> })
  })

  if (showAge) {
    metadata.push({
      key: 'age',
      node: (
        <Tip label={absoluteAge} side="top">
          <time
            aria-label={`${age}, ${absoluteAge}`}
            className="pointer-events-auto whitespace-nowrap tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            dateTime={timestampDate.toISOString()}
            tabIndex={0}
          >
            {age}
          </time>
        </Tip>
      )
    })
  }

  if (hasBranchChildren) {
    metadata.push({
      key: 'child-count',
      node: (
        <Tip label={`${branchChildCount} child chat${branchChildCount === 1 ? '' : 's'}`} side="top">
          <span
            aria-label={`${branchChildCount} child chat${branchChildCount === 1 ? '' : 's'}`}
            className="pointer-events-auto flex items-center gap-1 whitespace-nowrap tabular-nums"
            data-session-child-count
          >
            <Codicon name="robot" size="0.75rem" />
            <span>{branchChildCount}</span>
          </span>
        </Tip>
      )
    })
  }

  const metadataNode =
    metadata.length > 0 ? (
      <span
        className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[0.625rem] leading-none text-(--ui-text-tertiary)"
        data-session-row-meta
      >
        {metadata.map(({ key, node }) => (
          <span className="min-w-0 shrink-0" key={key}>
            {node}
          </span>
        ))}
      </span>
    ) : null

  // A handed-off session's live source is local, but it originated on a
  // messaging platform — surface that origin as a small badge so e.g. a
  // Telegram thread continued here still reads as Telegram.
  const handoffSource = handoffOriginSource(session.handoff_state, session.handoff_platform)
  const handoffLabel = handoffSource ? (sessionSourceLabel(handoffSource) ?? handoffSource) : null
  // The same resolved state the row's dot paints, so the arc and the dot cannot
  // contradict each other. A selector, not a plain useStore: the map is rebuilt
  // whenever any session's status changes, but a row only repaints on its own.
  const subagentSession = isSubagentSession(session)
  const dotState = useStoreSelector($sessionDotStateById, states => states[session.id] ?? 'idle')
  const liveTurn = hasLiveTurn(dotState)
  const projectDotStoredSessionId = subagentSession ? null : session.id

  // Card header line: the workspace this belongs to — the project when it
  // resolves (same function the session color reads, so name and tint agree;
  // a worktree reports its repo, not the scratch dir it sits in), else the
  // bare cwd leaf, else the same synthetic "Home" the project views use for
  // workspace-less chats. Always text: an empty header line reads as a hole.
  // A SELECTOR, not useStore($projects): the projects atom refreshes on the
  // tree poll with fresh identity, and a plain subscription would re-render
  // every row (card or not) on every poll. Selecting the resolved label means
  // a row only repaints when its own label actually changes — and one-line
  // rows always select null.
  const context = useStoreSelector($projects, projects =>
    card ? (sessionProjectLabel(session, projects) ?? (pathLeaf(session.cwd) || t.sidebar.projects.home)) : null
  )

  // Card footer line: which model worked on it and how big it got. Rendered
  // as separate spans with a flex gap — a joined string can't put real space
  // between them (HTML collapses runs of whitespace to one).
  const model = card && session.model ? displayModelName(session.model) : ''
  const size = card && session.message_count > 0 ? r.messageCount(session.message_count) : ''
  // Live plan progress ("3/7"), far right of the footer. A selector keyed to
  // this row: only rows whose own fraction changes repaint on todo events.
  const todoProgress = useStoreSelector($todoProgressBySession, progress => (card ? progress[session.id] : undefined))

  // An archived session has no live status to paint, so the archive glyph takes
  // the lead slot the dot would occupy instead of adding a column of its own.
  const lead = session.archived ? (
    <SidebarRowLeadGlyph className="text-(--ui-text-quaternary)">
      <Codicon name="archive" size="0.75rem" />
    </SidebarRowLeadGlyph>
  ) : null

  const branchToggleNode = hasBranchChildren ? (
    <Tip label={branchCollapsed ? 'Expand child chats' : 'Collapse child chats'} side="top">
      <button
        aria-label={branchCollapsed ? 'Expand child chats' : 'Collapse child chats'}
        className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-(--ui-text-tertiary) transition hover:bg-(--ui-control-active-background) hover:text-foreground"
        data-row-actions
        data-session-branch-toggle
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          triggerHaptic('selection')
          onToggleBranch?.()
        }}
        type="button"
      >
        <Codicon name={branchCollapsed ? 'chevron-right' : 'chevron-down'} size="0.75rem" />
      </button>
    </Tip>
  ) : null

  // The action cluster is an explicit control row. Compact rows position it on
  // the second line; cards keep only controls in their header while metadata
  // sits beside the title on the card's second row.
  const actionsNode = (
    <div
      className={cn('relative z-2 flex shrink-0 items-center justify-end gap-1', card && hasBranchChildren && 'mr-7')}
      data-row-actions
    >
      {session.archived || subagentSession ? null : <SessionStatusIcon storedSessionId={session.id} />}
      {!session.archived ? (
        <Button
          aria-label={r.archive}
          className="size-5 rounded-[4px] bg-transparent text-(--ui-text-tertiary) transition-colors duration-100 hover:bg-(--ui-control-active-background) hover:text-foreground focus-visible:bg-(--ui-control-active-background) focus-visible:text-foreground focus-visible:ring-0 [&_svg]:size-3.5!"
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            triggerHaptic('selection')
            onArchive()
          }}
          onPointerDown={event => event.stopPropagation()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Codicon name="archive" size="0.875rem" />
        </Button>
      ) : null}
      <SessionActionsMenu
        onArchive={onArchive}
        onBranch={onBranch}
        onDelete={onDelete}
        onPin={onPin}
        pinned={isPinned}
        profile={session.profile}
        sessionId={session.id}
        title={title}
      >
        <Button
          aria-label={r.sessionActions}
          className="size-5 rounded-[4px] bg-transparent text-(--ui-text-tertiary) transition-colors duration-100 hover:bg-(--ui-control-active-background) hover:text-foreground focus-visible:bg-(--ui-control-active-background) focus-visible:text-foreground focus-visible:ring-0 data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground [&_svg]:size-3.5!"
          onClick={event => event.stopPropagation()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Codicon name="kebab-vertical" size="0.875rem" />
        </Button>
      </SessionActionsMenu>
    </div>
  )

  return (
    <SessionContextMenu
      onArchive={onArchive}
      onBranch={onBranch}
      onDelete={onDelete}
      onPin={onPin}
      pinned={isPinned}
      profile={session.profile}
      sessionId={session.id}
      title={title}
    >
      <SidebarRowShell
        actions={undefined}
        className={cn(
          'group row-hover relative',
          card && SIDEBAR_ROW_CARD_MIN_H,
          isSelected && 'bg-(--ui-row-active-background)',
          liveTurn && 'text-foreground',
          // Opaque surface while lifted so the dragged row erases what's under
          // it (translucency let the rows below bleed through).
          dragging && 'z-10 cursor-grabbing bg-(--ui-sidebar-surface-background)',
          className
        )}
        data-working={liveTurn ? 'true' : undefined}
        // The row runs BOTH drags off one press, and each declines outside its
        // own region — so no timing/arbitration rule is needed and neither can
        // steal the other's gesture. Over the sidebar only the reorder has a
        // target (the session drop denies: side chrome hosts no main tile);
        // over the tree only the session drop does (no sortable row there).
        // Whichever one the release lands on is the one that commits.
        {...dragHandleProps}
        onPointerDown={event => {
          // The grabber already carries these same listeners, and the ⋯
          // cluster keeps its own gestures.
          if ((event.target as HTMLElement).closest('[data-reorder-handle], [data-row-actions]')) {
            return
          }

          // A POINTER drag on the shared drag session (never native HTML5 DnD:
          // no macOS snap-back, Esc aborts instantly). Sub-threshold releases
          // stay ordinary clicks, so resume / pin / open-in-window are
          // untouched.
          startSessionDrag({ id: session.id, profile: session.profile || 'default', title }, event)
          dragHandleProps?.onPointerDown?.(event)
        }}
        // Hovering a row from another profile (the all-profiles view) telegraphs
        // a cross-profile resume — start that backend's spawn now so the click
        // doesn't pay the full cold boot. Same-profile rows no-op inside
        // prewarmProfileBackend.
        onPointerEnter={startPrewarm}
        onPointerLeave={cancelPrewarm}
        ref={ref}
        style={style}
        {...rest}
      >
        <SidebarRowBody
          // Every trailing figure lives in the actions slot, which the row
          // measures — so the title needs a gap from it and nothing else. Hover
          // changes what you can see in that slot, never how wide it is.
          className={cn(
            'z-0 pr-2',
            branchStem && 'pl-3.5',
            card
              ? 'flex-col items-stretch justify-center py-1.5 [--card-gap:0.6rem] gap-(--card-gap)'
              : 'flex-col items-stretch justify-center gap-1 py-1'
          )}
          // Middle-click = open in a new tab (browser muscle memory).
          {...middleClickHandlers(() => {
            triggerHaptic('selection')
            openSession(session.id, () => undefined, 'tab')
          })}
          onClick={event => {
            const mod = event.metaKey || event.ctrlKey

            // ⇧⌘-click → pop into its own window (needs standalone windows).
            if (mod && event.shiftKey) {
              event.preventDefault()
              event.stopPropagation()
              triggerHaptic('selection')
              openSession(session.id, () => undefined, 'window')

              return
            }

            // ⌘/⌃-click → open in a new tab (stack into main).
            if (mod) {
              event.preventDefault()
              event.stopPropagation()
              triggerHaptic('selection')
              openSession(session.id, () => undefined, 'tab')

              return
            }

            // ⇧-click → pin.
            if (event.shiftKey) {
              event.preventDefault()
              event.stopPropagation()
              triggerHaptic('selection')
              onPin()

              return
            }

            onResume()
          }}
          onDoubleClick={event => {
            event.preventDefault()
            event.stopPropagation()
            triggerHaptic('selection')
            promoteSessionTile(session.id)
            openSession(session.id, () => undefined, 'tab')
          }}
        >
          {(() => {
            const leadNode = reorderable ? (
              <SidebarRowGrab ariaLabel={handleLabel} dragging={dragging} dragHandleProps={dragHandleProps}>
                {lead ?? (
                  <SessionProjectDot
                    branchStem={branchStem}
                    className="transition-opacity group-hover/handle:opacity-0 group-focus-within/handle:opacity-0"
                    session={session}
                    storedSessionId={projectDotStoredSessionId}
                  />
                )}
              </SidebarRowGrab>
            ) : (
              <SidebarRowLead className="overflow-hidden">
                {lead ?? <SessionProjectDot branchStem={branchStem} session={session} storedSessionId={projectDotStoredSessionId} />}
              </SidebarRowLead>
            )

            const handoffBadge =
              handoffSource && handoffLabel ? (
                <Tip label={r.handoffOrigin(handoffLabel)}>
                  <PlatformAvatar
                    className="-mt-px size-4 shrink-0 rounded-[4px] text-[0.5rem] [&_svg]:size-2.5"
                    platformId={handoffSource}
                    platformName={handoffLabel}
                  />
                </Tip>
              ) : null

            if (!card) {
              return (
                <>
                  <div
                    className={cn('flex min-w-0 items-center gap-1.5', hasBranchChildren && 'pr-7')}
                    data-session-row-primary
                  >
                    {leadNode}
                    {handoffBadge}
                    <SubagentSessionIcon session={session} storedSessionId={session.id} tooltip />
                    <OverflowTip label={title}>
                      <SidebarRowLabel
                        className="hover-marquee flex-1 font-normal group-hover:text-foreground group-data-[working=true]:text-foreground/90"
                        onPointerEnter={armMarquee}
                        onPointerLeave={disarmMarquee}
                      >
                        <span className="hover-marquee-inner">{title}</span>
                      </SidebarRowLabel>
                    </OverflowTip>
                  </div>
                  <div
                    className={cn('flex min-h-5 min-w-0 items-center pl-5 pr-12', branchStem && 'pl-8')}
                    data-session-row-secondary
                  >
                    {metadataNode}
                  </div>
                </>
              )
            }

            return (
              <>
                {/* Header row — ONE div: dot, context, then the age/kebab
                    cluster in flow at its right edge. Keeping the cluster
                    inside this line (instead of the shell's full-height side
                    column) means title/preview/meta below span the card's
                    entire width — nothing truncates against the kebab. */}
                <div className="flex min-w-0 items-center gap-1.5">
                  {leadNode}
                  <span className="min-w-0 flex-1 truncate text-[0.6875rem] leading-none text-(--ui-text-tertiary)">
                    {context}
                  </span>
                  {handoffBadge}
                  {actionsNode}
                </div>
                {/* Title + preview: ONE grouped cell with its own tight
                    internal gap — it does not inherit the card's rhythm. */}
                <div className="-mt-[0.2em] flex min-w-0 flex-col gap-[0.3rem]">
                  <div className="flex min-w-0 items-center gap-1.5" data-session-card-secondary>
                    <SubagentSessionIcon session={session} storedSessionId={session.id} tooltip />
                    <OverflowTip label={title}>
                      <SidebarRowLabel
                        className="hover-marquee flex-1 text-[0.8125rem] leading-none font-medium text-(--ui-text-primary) group-data-[working=true]:text-foreground"
                        onPointerEnter={armMarquee}
                        onPointerLeave={disarmMarquee}
                      >
                        <span className="hover-marquee-inner">{title}</span>
                      </SidebarRowLabel>
                    </OverflowTip>
                    {metadataNode ? <span className="min-w-0 max-w-24 shrink-0">{metadataNode}</span> : null}
                  </div>
                  {session.preview && rowMeta.includes('preview') ? (
                    <span className="min-w-0 truncate text-[0.625rem] leading-none text-(--ui-text-quaternary)">
                      {session.preview}
                    </span>
                  ) : null}
                </div>
                {model || size || todoProgress ? (
                  <span className="flex min-w-0 items-baseline gap-2 text-[0.625rem] leading-none text-(--ui-text-tertiary)">
                    {model ? <span className="min-w-0 truncate">{model}</span> : null}
                    {size ? <span className="shrink-0 tabular-nums">{size}</span> : null}
                    {todoProgress ? (
                      <span className="ml-auto shrink-0 tabular-nums" title={r.todoProgress}>
                        {todoProgress}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </>
            )
          })()}
        </SidebarRowBody>
        {branchToggleNode ? (
          <div
            className={cn('absolute right-1 z-3 flex items-center', card ? 'top-1.5' : 'top-0.5')}
            data-row-actions
            data-session-row-primary-actions
          >
            {branchToggleNode}
          </div>
        ) : null}
        {!card ? (
          <div
            className="absolute bottom-0.5 right-1 flex items-center"
            data-row-actions
            data-session-row-secondary-actions
          >
            {actionsNode}
          </div>
        ) : null}
      </SidebarRowShell>
    </SessionContextMenu>
  )
}

// The sidebar re-renders on every stream tick ($sessions/$workingSessionIds
// churn), and it stays mounted beneath every overlay — so an unmemoized row
// re-rendered the whole list (and its Codicon/label/status-dot subtree) on each
// delta, bleeding churn into Settings, Cron, Profiles, Artifacts, etc.
//
// The callback props (onArchive/onResume/…) are fresh closures every render by
// design (they close over the row's session id), so a default memo never bails.
// They're pure id-forwarders, though — identical behavior for a given row — so
// the comparator deliberately ignores them and compares only the DATA that
// changes what the row paints. A row whose session/selection/pin state is
// unchanged now bails out, even while a sibling session streams; its own status
// arrives through a store subscription, which re-renders it past this bail.
function rowPropsEqual(a: SidebarSessionRowProps, b: SidebarSessionRowProps): boolean {
  return (
    a.session === b.session &&
    a.isPinned === b.isPinned &&
    a.isSelected === b.isSelected &&
    a.branchStem === b.branchStem &&
    a.branchChildCount === b.branchChildCount &&
    a.hasBranchChildren === b.hasBranchChildren &&
    a.branchCollapsed === b.branchCollapsed &&
    a.reorderable === b.reorderable &&
    a.dragging === b.dragging &&
    a.showProfile === b.showProfile &&
    a.card === b.card &&
    a.dragHandleProps === b.dragHandleProps &&
    a.className === b.className &&
    a.style === b.style
  )
}

export const SidebarSessionRow = memo(SidebarSessionRowImpl, rowPropsEqual)
