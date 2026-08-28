import { cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IS_MAC } from '@/lib/keybinds/combo'
import { resetBinding } from '@/store/keybinds'

import { useKeybinds } from './use-keybinds'

vi.mock('@/themes/context', () => ({
  useTheme: () => ({ resolvedMode: 'dark', setMode: vi.fn() })
}))

function Harness({
  openNewSessionTab,
  startFreshSession
}: {
  openNewSessionTab: () => void
  startFreshSession: () => void
}) {
  const deps = {
    openNewSessionTab,
    startFreshSession,
    toggleCommandCenter: vi.fn(),
    toggleSelectedPin: vi.fn()
  }

  useKeybinds(deps)

  return null
}

describe('useKeybinds New Session', () => {
  afterEach(() => {
    cleanup()
    resetBinding('session.new')
    vi.restoreAllMocks()
  })

  it('does not let uppercase N or Cmd/Ctrl+N create a session', () => {
    const openNewSessionTab = vi.fn()
    const startFreshSession = vi.fn()

    render(
      <MemoryRouter>
        <Harness openNewSessionTab={openNewSessionTab} startFreshSession={startFreshSession} />
      </MemoryRouter>
    )

    fireEvent.keyDown(window, { code: 'KeyN', key: 'N', shiftKey: true })
    fireEvent.keyDown(window, {
      code: 'KeyN',
      ctrlKey: !IS_MAC,
      key: 'n',
      metaKey: IS_MAC
    })

    expect(openNewSessionTab).not.toHaveBeenCalled()
    expect(startFreshSession).not.toHaveBeenCalled()
  })

  it('keeps Cmd/Ctrl+T as the explicit new-session tab shortcut', () => {
    const openNewSessionTab = vi.fn()

    render(
      <MemoryRouter>
        <Harness openNewSessionTab={openNewSessionTab} startFreshSession={vi.fn()} />
      </MemoryRouter>
    )

    fireEvent.keyDown(window, {
      code: 'KeyT',
      ctrlKey: !IS_MAC,
      key: 't',
      metaKey: IS_MAC
    })

    expect(openNewSessionTab).toHaveBeenCalledTimes(1)
  })
})
