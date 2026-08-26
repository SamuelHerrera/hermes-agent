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

  it('opens a new session tab on Cmd/Ctrl+N instead of replacing the current chat', () => {
    const openNewSessionTab = vi.fn()
    const startFreshSession = vi.fn()

    render(
      <MemoryRouter>
        <Harness openNewSessionTab={openNewSessionTab} startFreshSession={startFreshSession} />
      </MemoryRouter>
    )

    fireEvent.keyDown(window, {
      code: 'KeyN',
      ctrlKey: !IS_MAC,
      key: 'n',
      metaKey: IS_MAC
    })

    expect(openNewSessionTab).toHaveBeenCalledTimes(1)
    expect(startFreshSession).not.toHaveBeenCalled()
  })
})
