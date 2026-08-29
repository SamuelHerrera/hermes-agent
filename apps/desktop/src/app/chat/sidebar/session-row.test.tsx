import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import type * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'
import { createClientSessionState } from '@/lib/chat-runtime'
import type * as ChatRuntime from '@/lib/chat-runtime'
import type * as Time from '@/lib/time'
import type * as ComposerStatusStore from '@/store/composer-status'
import { $sidebarRowMeta } from '@/store/layout'
import { setSessions } from '@/store/session'
import type * as SessionStore from '@/store/session'
import { setSessionColorOverride } from '@/store/session-color'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'
import type * as SessionStatesStore from '@/store/session-states'
import type * as WindowsStore from '@/store/windows'

import { SidebarSessionRow } from './session-row'

afterEach(() => {
  cleanup()
  act(() => {
    $sidebarRowMeta.set(['preview', 'updated'])
  })
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        projects: { home: 'Home' },
        row: {
          ageMin: 'm',
          ageNow: 'now',
          archive: 'Archive',
          backgroundRunning: 'Running in background',
          finishedUnread: 'Finished',
          handoffOrigin: (platform: string) => `Started on ${platform}`,
          messageCount: (count: number) => `${count} messages`,
          needsInput: 'Needs input',
          sessionActions: 'Session actions',
          sessionRunning: 'Running',
          waitingForAnswer: 'Waiting for answer'
        }
      },
      assistant: {
        thread: {
          today: (time: string) => `Today at ${time}`,
          yesterday: (time: string) => `Yesterday at ${time}`
        }
      }
    }
  })
}))

vi.mock('@/app/chat/profile-tag', () => ({ ProfileTag: () => null }))
vi.mock('@/app/chat/session-drag', () => ({ startSessionDrag: vi.fn() }))
// PlatformAvatar is intentionally NOT mocked (do not reintroduce this — see
// #67500, Gille's third pass): it's a forwardRef component that spreads its
// props onto the rendered span, and mocking it with a stand-in that spreads
// props itself only proves the MOCK forwards them, not that the real
// component does. This file exercises the actual production component so a
// regression in its ref/prop forwarding fails here again.
// Only `sessionTitle` is overridden (makeSession fakes a bare `title` the real
// one wouldn't read); the rest of the module is genuine so the running-status
// test can build session state with the same factory the app uses. It is a spy because
// the row calls it exactly once per render, which is how the isolation test
// below counts repaints.
const sessionTitle = vi.fn((s: SessionInfo) => (s as unknown as { title: string }).title)

vi.mock('@/lib/chat-runtime', async importOriginal => {
  const actual = await importOriginal<typeof ChatRuntime>()

  return { ...actual, sessionTitle: (s: SessionInfo) => sessionTitle(s) }
})
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/lib/session-source', () => ({
  handoffOriginSource: (state?: string, platform?: string) => (state && platform ? platform : null),
  sessionSourceLabel: (source: string) => source
}))
vi.mock('@/lib/time', async importOriginal => {
  const actual = await importOriginal<typeof Time>()

  return { ...actual, coarseElapsed: () => ({ unit: 'minute' as const, value: 5 }) }
})

// These mocks use importOriginal rather than replacing the module wholesale:
// session-row.tsx (and its transitive imports, e.g. session-color.ts) reads
// several store exports beyond the ones this file cares about, and that set
// keeps growing as the app evolves upstream. A wholesale replacement mock
// silently turns every export it doesn't list into `undefined`, which then
// crashes nanostores' `computed()` the moment a new dependency is added
// upstream (as happened twice already: $stalledSessionIds, then $sessions).
// Overriding only the named atoms we actually control keeps this test
// resilient to that drift.
vi.mock('@/store/composer-status', async importOriginal => {
  const actual = await importOriginal<typeof ComposerStatusStore>()

  return { ...actual, $backgroundRunningSessionIds: atom<string[]>([]) }
})
vi.mock('@/store/session', async importOriginal => {
  const actual = await importOriginal<typeof SessionStore>()

  return { ...actual, $unreadFinishedSessionIds: atom<string[]>([]) }
})
vi.mock('@/store/session-states', async importOriginal => {
  const actual = await importOriginal<typeof SessionStatesStore>()

  return {
    ...actual,
    $attentionSessionIds: atom<string[]>([]),
    $stalledSessionIds: atom<string[]>([]),
    openSessionTile: vi.fn()
  }
})
vi.mock('@/store/windows', async importOriginal => {
  const actual = await importOriginal<typeof WindowsStore>()

  return {
    ...actual,
    canOpenSessionWindow: () => false,
    openSessionInNewWindow: vi.fn()
  }
})

// SessionActionsMenu open behavior is covered in session-actions-menu.test.tsx
// against the real component. Stub it here so this file stays focused on the
// row chrome (handoff avatar tip, etc.).
vi.mock('./session-actions-menu', () => ({
  SessionActionsMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SessionContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('./use-profile-prewarm', () => ({
  useProfilePrewarm: () => ({ cancelPrewarm: vi.fn(), startPrewarm: vi.fn() })
}))

function makeSession(overrides: Partial<SessionInfo> & { title: string }): SessionInfo {
  return {
    handoff_platform: null,
    handoff_state: null,
    id: 's1',
    last_active: 0,
    profile: 'default',
    started_at: 0,
    ...overrides
  } as unknown as SessionInfo
}

const tipTrigger = (el: HTMLElement) => el.closest('[data-slot="tooltip-trigger"]')

// The status dot always paints an aria-hidden placeholder so every row's title
// keeps the same left edge, so "the row's aria-hidden span" no longer names the
// avatar on its own. `inline-grid` is PlatformAvatar's own layout class in both
// of its branches — brand glyph and first-letter fallback — and the row passes
// it no display class that tailwind-merge could drop it for.
const handoffAvatar = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('span[aria-hidden="true"].inline-grid')

const noop = vi.fn()

describe('SidebarSessionRow compact layout', () => {
  it('keeps title and leading icon on the first line and moves tokens/age to a metadata line', () => {
    act(() => {
      $sidebarRowMeta.set(['tokens', 'updated'])
    })

    const { container } = renderRow(
      makeSession({ input_tokens: 1_200, last_active: 1_000, output_tokens: 300, started_at: 1_000, title: 'Two line chat' })
    )

    const title = screen.getByText('Two line chat')
    const tokenMeta = screen.getByText('1.5k')
    const ageMeta = screen.getByText('5m')
    const primaryLine = title.closest('[data-session-row-primary]')
    const metadataLine = tokenMeta.closest('[data-session-row-meta]')

    expect(primaryLine).toBeTruthy()
    expect(metadataLine).toBeTruthy()
    expect(primaryLine).not.toBe(metadataLine)
    expect(metadataLine?.contains(ageMeta)).toBe(true)
    expect(container.querySelector('[data-session-project-dot]')).toBeTruthy()
  })

  it('shows archive and session menu as visible second-row buttons without removing the context menu actions', () => {
    const { container } = renderRow(makeSession({ title: 'Action row' }))

    const archive = screen.getByRole('button', { name: 'Archive' })
    const menu = screen.getByRole('button', { name: 'Session actions' })

    const primaryLine = screen.getByText('Action row').closest('[data-session-row-primary]')
    const actionLine = container.querySelector('[data-session-row-secondary-actions]')

    expect(archive).toBeTruthy()
    expect(menu).toBeTruthy()
    expect(menu.className).not.toContain('text-transparent')
    expect(primaryLine?.contains(archive)).toBe(false)
    expect(primaryLine?.contains(menu)).toBe(false)
    expect(actionLine?.contains(archive)).toBe(true)
    expect(actionLine?.contains(menu)).toBe(true)
  })

  it('shows only the branch leaf on the metadata row and exposes the full branch through the tooltip trigger', () => {
    renderRow(makeSession({ git_branch: 'sam/feature/sidebar-counts', title: 'Branch chat' }))

    const branch = screen.getByText('sidebar-counts')
    const metadataLine = branch.closest('[data-session-row-meta]')

    expect(metadataLine).toBeTruthy()
    expect(tipTrigger(branch)).toBeTruthy()
    expect(branch.getAttribute('aria-label')).toBe('Branch sam/feature/sidebar-counts')
    expect(branch.getAttribute('tabindex')).toBeNull()
    expect(screen.queryByText('sam/feature/sidebar-counts')).toBeNull()
  })
})

const renderRow = (session: SessionInfo) => {
  act(() => {
    setSessions([session])
  })

  return render(
    <SidebarSessionRow
      isPinned={false}
      isSelected={false}
      onArchive={noop}
      onDelete={noop}
      onPin={noop}
      onResume={noop}
      session={session}
    />
  )
}

// The row no longer takes its running state as a prop, so this drives the real
// store the way the app does. $workingSessionIds is the actual computed here
// (the mock above only overrides its siblings), which is what makes this cover
// the wiring rather than the predicate — Samuel's preferred cue is identity dot
// on the left plus a separate transient status icon on the right, not a row arc.
describe('SidebarSessionRow running indicator', () => {
  afterEach(() => {
    act(() => {
      clearAllSessionStates()
      setSessionColorOverride('s1', null)
    })
  })

  const arc = (container: HTMLElement) => container.querySelector('.arc-row')

  it('wraps the project dot with the running ring on the left', () => {
    act(() => {
      setSessionColorOverride('s1', '#2f81f7')
      publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })
    })

    const { container } = renderRow(makeSession({ title: 'Running' }))
    const lead = container.querySelector<HTMLElement>('[data-session-project-dot]')
    const spinner = lead?.querySelector<HTMLElement>('.codicon-loading.codicon-modifier-spin')

    expect(arc(container)).toBeNull()
    expect(lead).toBeTruthy()
    expect(lead?.querySelector('.rounded-full')).toBeTruthy()
    expect(lead?.querySelector<HTMLElement>('.rounded-full')?.style.backgroundColor).toBe('rgb(47, 129, 247)')
    expect(spinner).toBeTruthy()
    expect(spinner?.closest('[data-session-project-dot]')).toBeTruthy()
    expect(container.querySelector('[data-row-actions] [data-session-status]')).toBeNull()
  })

  it('suppresses transient status for an archived session', () => {
    act(() => {
      publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })
    })

    const { container } = renderRow(makeSession({ archived: true, title: 'Archived' }))

    expect(container.querySelector('.codicon-archive')).toBeTruthy()
    expect(container.querySelector('[data-session-status]')).toBeNull()
  })

  it('keeps the subagent robot glyph while its turn is running', () => {
    act(() => {
      publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })
    })

    const { container } = renderRow(makeSession({ delegate_parent_session_id: 'parent', title: 'Review diff' }))

    expect(container.querySelector('.codicon-robot')).toBeTruthy()
    expect(container.querySelector('.codicon-loading.codicon-modifier-spin')).toBeNull()
  })

  // The row owns its status subscription so a turn starting repaints that row
  // and nothing else — not its siblings, and not the list around them. Rows
  // render once per fiber, so counting `sessionTitle` counts repaints.
  it('repaints only the session whose turn started', () => {
    act(() => {
      setSessions([makeSession({ id: 's1', title: 'One' }), makeSession({ id: 's2', title: 'Two' })])
    })

    render(
      <>
        {[makeSession({ id: 's1', title: 'One' }), makeSession({ id: 's2', title: 'Two' })].map(session => (
          <SidebarSessionRow
            isPinned={false}
            isSelected={false}
            key={session.id}
            onArchive={noop}
            onDelete={noop}
            onPin={noop}
            onResume={noop}
            session={session}
          />
        ))}
      </>
    )
    sessionTitle.mockClear()

    act(() => {
      publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })
    })

    expect(sessionTitle).toHaveBeenCalledTimes(1)
    expect(sessionTitle).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
  })
})

describe('SidebarSessionRow', () => {
  it('keeps an aria-label on the kebab without wrapping it in a Tip', () => {
    render(
      <SidebarSessionRow
        isPinned={false}
        isSelected={false}
        onArchive={noop}
        onDelete={noop}
        onPin={noop}
        onResume={noop}
        session={makeSession({ title: 'Hermes doctor health check results' })}
      />
    )

    const kebab = screen.getByRole('button', { name: 'Session actions' })
    expect(tipTrigger(kebab)).toBeNull()
  })

  it('keeps the disclosure on the primary row and puts the child-chat icon and count beside age metadata', () => {
    const onResume = vi.fn()
    const onToggleBranch = vi.fn()

    const { container } = render(
      <SidebarSessionRow
        branchChildCount={3}
        hasBranchChildren
        isPinned={false}
        isSelected={false}
        onArchive={noop}
        onDelete={noop}
        onPin={noop}
        onResume={onResume}
        onToggleBranch={onToggleBranch}
        session={makeSession({ title: 'Parent chat' })}
      />
    )

    const primaryLine = screen.getByText('Parent chat').closest('[data-session-row-primary]')
    const rowBody = screen.getByText('Parent chat').closest('button')
    const toggle = screen.getByRole('button', { name: 'Collapse child chats' })
    const age = screen.getByText('5m')
    const childCount = container.querySelector('[data-session-child-count]')
    const primaryActions = container.querySelector('[data-session-row-primary-actions]')
    const secondaryActions = container.querySelector('[data-session-row-secondary-actions]')

    expect(primaryLine?.contains(toggle)).toBe(false)
    expect(rowBody?.contains(toggle)).toBe(false)
    expect(primaryActions?.contains(toggle)).toBe(true)
    expect(secondaryActions?.contains(toggle)).toBe(false)
    expect(toggle.textContent).not.toContain('3')
    expect(toggle.querySelector('.codicon-robot')).toBeNull()
    expect(childCount?.textContent).toContain('3')
    expect(childCount?.querySelector('.codicon-robot')).toBeTruthy()
    expect(age.closest('[data-session-row-meta]')?.contains(childCount)).toBe(true)
    expect(age.parentElement?.nextElementSibling?.contains(childCount)).toBe(true)
    expect(secondaryActions?.contains(screen.getByRole('button', { name: 'Archive' }))).toBe(true)
    fireEvent.click(toggle)
    expect(onToggleBranch).toHaveBeenCalledOnce()
    expect(onResume).not.toHaveBeenCalled()
  })

  it('keeps the child-chat disclosure outside the row-wide button for card rows too', () => {
    const { container } = render(
      <SidebarSessionRow
        branchChildCount={1}
        card
        hasBranchChildren
        isPinned={false}
        isSelected={false}
        onArchive={noop}
        onDelete={noop}
        onPin={noop}
        onResume={noop}
        onToggleBranch={noop}
        session={makeSession({ title: 'Card parent' })}
      />
    )

    const toggle = screen.getByRole('button', { name: 'Collapse child chats' })
    const rowBody = screen.getByText('Card parent').closest('button')

    expect(rowBody?.contains(toggle)).toBe(false)
    expect(container.querySelector('[data-session-row-primary-actions]')?.contains(toggle)).toBe(true)
  })

  it('places card age and child count beside the title on the second row', () => {
    const { container } = render(
      <SidebarSessionRow
        branchChildCount={2}
        card
        hasBranchChildren
        isPinned={false}
        isSelected={false}
        onArchive={noop}
        onDelete={noop}
        onPin={noop}
        onResume={noop}
        onToggleBranch={noop}
        session={makeSession({ title: 'Card metadata parent' })}
      />
    )

    const secondRow = container.querySelector('[data-session-card-secondary]')
    const age = screen.getByText('5m')
    const childCount = container.querySelector('[data-session-child-count]')

    expect(secondRow).toBeTruthy()
    expect(secondRow?.contains(screen.getByText('Card metadata parent'))).toBe(true)
    expect(secondRow?.contains(age)).toBe(true)
    expect(secondRow?.contains(childCount)).toBe(true)
  })

  // Full-title tooltip on hover (#83000-class ask): the label is a tooltip
  // trigger, but the tip only opens when the title is actually truncated.
  describe('full-title overflow tooltip', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    const title = 'A very long session title that the sidebar cannot possibly fit'

    /** The rendered title label (tooltip trigger is the label itself). */
    const label = () => screen.getByText(title).closest('[data-slot="tooltip-trigger"]') as HTMLElement

    const setWidths = (el: HTMLElement, scrollWidth: number, clientWidth: number) => {
      Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
    }

    it('wraps the title in a tooltip trigger', () => {
      renderRow(makeSession({ title }))

      expect(label()).toBeTruthy()
    })

    it('opens with the full title after a settled hover when the title overflows', () => {
      vi.useFakeTimers()
      renderRow(makeSession({ title }))

      const el = label()
      setWidths(el, 300, 100)

      act(() => {
        fireEvent.pointerEnter(el)
        vi.advanceTimersByTime(700)
      })

      expect(screen.getByRole('tooltip').textContent).toContain(title)
    })

    it('stays closed when the title fits', () => {
      vi.useFakeTimers()
      renderRow(makeSession({ title }))

      const el = label()
      setWidths(el, 100, 100)

      act(() => {
        fireEvent.pointerEnter(el)
        vi.advanceTimersByTime(700)
      })

      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('cancels a pending open when the pointer leaves before the delay', () => {
      vi.useFakeTimers()
      renderRow(makeSession({ title }))

      const el = label()
      setWidths(el, 300, 100)

      act(() => {
        fireEvent.pointerEnter(el)
        vi.advanceTimersByTime(200)
        fireEvent.pointerLeave(el)
        vi.advanceTimersByTime(700)
      })

      expect(screen.queryByRole('tooltip')).toBeNull()
    })
  })

  it('exposes the exact session time through a focusable Tip trigger', () => {
    const startedAt = Math.floor(Date.now() / 1000) - 5 * 60

    render(
      <SidebarSessionRow
        isPinned={false}
        isSelected={false}
        onArchive={noop}
        onDelete={noop}
        onPin={noop}
        onResume={noop}
        session={makeSession({ started_at: startedAt, title: 'Timestamped session' })}
      />
    )

    const age = screen.getByText('5m')
    expect(age.tagName).toBe('TIME')
    expect(age.getAttribute('datetime')).toBe(new Date(startedAt * 1000).toISOString())
    expect(age.getAttribute('aria-label')).toMatch(/^5m, Today at /)
    expect(age.getAttribute('tabindex')).toBe('0')
    expect(age.getAttribute('title')).toBeNull()
    expect(tipTrigger(age)).toBeTruthy()
  })

  it('does not render a handoff avatar for a locally-started session', () => {
    const { container } = render(
      <SidebarSessionRow
        isPinned={false}
        isSelected={false}
        onArchive={noop}
        onDelete={noop}
        onPin={noop}
        onResume={noop}
        session={makeSession({ title: 'Local session' })}
      />
    )

    expect(handoffAvatar(container)).toBeNull()
  })

  it('wraps the handoff platform avatar in a Tip for a session started on another platform', () => {
    const { container } = render(
      <SidebarSessionRow
        isPinned={false}
        isSelected={false}
        onArchive={noop}
        onDelete={noop}
        onPin={noop}
        onResume={noop}
        session={makeSession({
          handoff_platform: 'telegram',
          handoff_state: 'active',
          title: 'Continued from Telegram'
        })}
      />
    )

    // PlatformAvatar is the REAL component here (see the note above the vi.mock
    // block, #67500 third pass) — it renders the Telegram brand SVG rather
    // than the platform name as text, so query the avatar span itself rather
    // than text content, and confirm its tooltip trigger actually attaches to
    // it — proving the real forwardRef/...rest path works, not a mock that
    // fakes it.
    const avatar = handoffAvatar(container)
    expect(avatar).toBeTruthy()
    expect(tipTrigger(avatar as HTMLElement)).toBeTruthy()
  })
})
