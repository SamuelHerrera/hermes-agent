import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assistantTextPart, type ChatMessage } from '@/lib/chat-messages'
import { $projectTree } from '@/store/projects'
import {
  $activeSessionId,
  $awaitingResponse,
  $busy,
  $contextSuggestions,
  $currentCwd,
  $currentModel,
  $currentProvider,
  $freshDraftReady,
  $gatewayState,
  $messages,
  $selectedStoredSessionId,
  $sessions
} from '@/store/session'
import { $sessionColorOverrides, setSessionColorOverride } from '@/store/session-color'

const threadRenderCount = vi.hoisted(() => ({ current: 0 }))
const threadProps = vi.hoisted(() => ({ current: null as null | { intro?: unknown } }))
const chatBarProps = vi.hoisted(() => ({ current: null as null | { sessionAccentColor?: string } }))

vi.mock('@/components/assistant-ui/thread', async () => {
  const React = await import('react')

  return {
    Thread: (props: { intro?: unknown }) => {
      threadRenderCount.current += 1
      threadProps.current = props

      return React.createElement('div', { 'data-testid': 'thread' })
    }
  }
})

vi.mock('@/components/Backdrop', async () => {
  const React = await import('react')

  return { Backdrop: () => React.createElement('div', { 'data-testid': 'backdrop' }) }
})

vi.mock('@/components/prompt-overlays', () => ({ PromptOverlays: () => null }))
vi.mock('@/components/chat/vibe-hearts', () => ({ COMPOSER_HEART_CONFIG: {}, HeartField: () => null }))
vi.mock('@/lib/model-options', () => ({
  modelOptionsQueryKey: (...parts: unknown[]) => ['model-options', ...parts],
  requestModelOptions: vi.fn(async () => ({ models: [] }))
}))
vi.mock('./chat-drop-overlay', () => ({ ChatDropOverlay: () => null }))
vi.mock('./chat-swap-overlay', () => ({ ChatSwapOverlay: () => null }))
vi.mock('./composer', async () => {
  const React = await import('react')

  return {
    ChatBar: (props: { sessionAccentColor?: string }) => {
      chatBarProps.current = props

      return React.createElement('div', { 'data-testid': 'chatbar' })
    },
    ChatBarFallback: () => null
  }
})
vi.mock('./hooks/use-file-drop-zone', () => ({
  useFileDropZone: () => ({ dragKind: null, dropHandlers: {} })
}))
vi.mock('./sidebar/session-actions-menu', async () => {
  const React = await import('react')

  return {
    SessionActionsMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'session-actions-menu' }, children)
  }
})

const { ChatView } = await import('./index')

function assistantMessage(id: string, text: string): ChatMessage {
  return {
    id,
    parts: [assistantTextPart(text)],
    role: 'assistant'
  }
}

describe('ChatView empty new sessions', () => {
  beforeEach(() => {
    threadProps.current = null
    chatBarProps.current = null
    $activeSessionId.set(null)
    $awaitingResponse.set(false)
    $busy.set(false)
    $contextSuggestions.set([])
    $currentCwd.set('')
    $currentModel.set('test-model')
    $currentProvider.set('test-provider')
    $freshDraftReady.set(true)
    $gatewayState.set('open')
    $messages.set([])
    $selectedStoredSessionId.set(null)
    $sessions.set([])
    $sessionColorOverrides.set({})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    $freshDraftReady.set(false)
    $gatewayState.set('idle')
    $sessionColorOverrides.set({})
  })

  it('keeps a primary fresh draft visually empty instead of rendering the intro wordmark', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <ChatView
            gateway={null}
            maxVoiceRecordingSeconds={120}
            onAddContextRef={vi.fn()}
            onAddUrl={vi.fn()}
            onAttachDroppedItems={vi.fn()}
            onAttachImageBlob={vi.fn()}
            onBranchInNewChat={vi.fn()}
            onCancel={vi.fn()}
            onDeleteSelectedSession={vi.fn()}
            onEdit={vi.fn()}
            onPasteClipboardImage={vi.fn()}
            onPickFiles={vi.fn()}
            onPickFolders={vi.fn()}
            onPickImages={vi.fn()}
            onReload={vi.fn()}
            onRemoveAttachment={vi.fn()}
            onRetryResume={vi.fn()}
            onSteer={vi.fn()}
            onSubmit={vi.fn()}
            onThreadMessagesChange={vi.fn()}
            onToggleSelectedPin={vi.fn()}
            onTranscribeAudio={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByTestId('thread')).toBeTruthy()
    expect(threadProps.current?.intro).toBeUndefined()
  })
})

describe('ChatView composer accent', () => {
  beforeEach(() => {
    chatBarProps.current = null
    $activeSessionId.set('runtime-1')
    $awaitingResponse.set(false)
    $busy.set(false)
    $contextSuggestions.set([])
    $currentCwd.set('/work')
    $currentModel.set('test-model')
    $currentProvider.set('test-provider')
    $freshDraftReady.set(false)
    $gatewayState.set('open')
    $messages.set([assistantMessage('assistant-1', 'Ready')])
    $selectedStoredSessionId.set('stored-1')
    $sessions.set([{ id: 'stored-1', message_count: 1, title: 'Colored chat' } as never])
    $projectTree.set([])
    $sessionColorOverrides.set({})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    $activeSessionId.set(null)
    $awaitingResponse.set(false)
    $busy.set(false)
    $contextSuggestions.set([])
    $currentCwd.set('')
    $currentModel.set('')
    $currentProvider.set('')
    $freshDraftReady.set(false)
    $gatewayState.set('idle')
    $messages.set([])
    $selectedStoredSessionId.set(null)
    $sessions.set([])
    $projectTree.set([])
    $sessionColorOverrides.set({})
  })

  it('passes the resolved project/session color to the composer chrome', () => {
    setSessionColorOverride('stored-1', '#ff5c7a')

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/stored-1']}>
          <ChatView
            gateway={null}
            maxVoiceRecordingSeconds={120}
            onAddContextRef={vi.fn()}
            onAddUrl={vi.fn()}
            onAttachDroppedItems={vi.fn()}
            onAttachImageBlob={vi.fn()}
            onBranchInNewChat={vi.fn()}
            onCancel={vi.fn()}
            onDeleteSelectedSession={vi.fn()}
            onEdit={vi.fn()}
            onPasteClipboardImage={vi.fn()}
            onPickFiles={vi.fn()}
            onPickFolders={vi.fn()}
            onPickImages={vi.fn()}
            onReload={vi.fn()}
            onRemoveAttachment={vi.fn()}
            onRetryResume={vi.fn()}
            onSteer={vi.fn()}
            onSubmit={vi.fn()}
            onThreadMessagesChange={vi.fn()}
            onToggleSelectedPin={vi.fn()}
            onTranscribeAudio={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByTestId('chatbar')).toBeTruthy()
    expect(chatBarProps.current?.sessionAccentColor).toBe('#ff5c7a')
  })

  it('uses the project color for a fresh draft before its session row is listed', () => {
    $currentCwd.set('/work/project')
    $sessions.set([])
    $projectTree.set([
      {
        color: '#ff5c7a',
        id: 'project-1',
        label: 'Project',
        path: '/work/project',
        repos: [],
        sessionCount: 0
      }
    ])

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/stored-1']}>
          <ChatView
            gateway={null}
            maxVoiceRecordingSeconds={120}
            onAddContextRef={vi.fn()}
            onAddUrl={vi.fn()}
            onAttachDroppedItems={vi.fn()}
            onAttachImageBlob={vi.fn()}
            onBranchInNewChat={vi.fn()}
            onCancel={vi.fn()}
            onDeleteSelectedSession={vi.fn()}
            onEdit={vi.fn()}
            onPasteClipboardImage={vi.fn()}
            onPickFiles={vi.fn()}
            onPickFolders={vi.fn()}
            onPickImages={vi.fn()}
            onReload={vi.fn()}
            onRemoveAttachment={vi.fn()}
            onRetryResume={vi.fn()}
            onSteer={vi.fn()}
            onSubmit={vi.fn()}
            onThreadMessagesChange={vi.fn()}
            onToggleSelectedPin={vi.fn()}
            onTranscribeAudio={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(chatBarProps.current?.sessionAccentColor).toBe('#ff5c7a')
  })
})

describe('ChatView render isolation', () => {
  beforeEach(() => {
    threadRenderCount.current = 0
    $activeSessionId.set('runtime-1')
    $awaitingResponse.set(false)
    $busy.set(false)
    $contextSuggestions.set([])
    $currentCwd.set('/work')
    $currentModel.set('test-model')
    $currentProvider.set('test-provider')
    $freshDraftReady.set(false)
    $gatewayState.set('closed')
    $messages.set([assistantMessage('assistant-1', 'Stable historical answer')])
    $selectedStoredSessionId.set('stored-1')
    $sessions.set([{ id: 'stored-1', message_count: 1, title: 'Stable chat' } as never])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    $activeSessionId.set(null)
    $awaitingResponse.set(false)
    $busy.set(false)
    $contextSuggestions.set([])
    $currentCwd.set('')
    $currentModel.set('')
    $currentProvider.set('')
    $freshDraftReady.set(false)
    $gatewayState.set('idle')
    $messages.set([])
    $selectedStoredSessionId.set(null)
    $sessions.set([])
  })

  it('does not re-render chat history when an unrelated parent idle tick updates', () => {
    const props = {
      gateway: null,
      maxVoiceRecordingSeconds: 120,
      onAddContextRef: vi.fn(),
      onAddUrl: vi.fn(),
      onAttachDroppedItems: vi.fn(),
      onAttachImageBlob: vi.fn(),
      onBranchInNewChat: vi.fn(),
      onCancel: vi.fn(),
      onDeleteSelectedSession: vi.fn(),
      onEdit: vi.fn(),
      onPasteClipboardImage: vi.fn(),
      onPickFiles: vi.fn(),
      onPickFolders: vi.fn(),
      onPickImages: vi.fn(),
      onReload: vi.fn(),
      onRemoveAttachment: vi.fn(),
      onRetryResume: vi.fn(),
      onSteer: vi.fn(),
      onSubmit: vi.fn(),
      onThreadMessagesChange: vi.fn(),
      onToggleSelectedPin: vi.fn(),
      onTranscribeAudio: vi.fn()
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })

    function ParentTickHarness() {
      const [tick, setTick] = useState(0)

      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/stored-1']}>
            <button onClick={() => setTick(value => value + 1)} type="button">
              parent tick {tick}
            </button>
            <ChatView {...props} />
          </MemoryRouter>
        </QueryClientProvider>
      )
    }

    render(<ParentTickHarness />)

    expect(screen.getByTestId('thread')).toBeTruthy()
    expect(threadRenderCount.current).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: /parent tick/i }))

    // memo(ChatView) with stable props must absorb the parent's idle tick —
    // the transcript (Thread) must not re-render. This is PR #38470's contract.
    expect(threadRenderCount.current).toBe(1)
  })
})
