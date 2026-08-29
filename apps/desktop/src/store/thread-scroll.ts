import { atom } from 'nanostores'

// "Is the thread parked at the bottom" is owned by use-stick-to-bottom inside
// ThreadMessageList (the scroll container). That state lives only in that
// subtree, so ThreadMessageList mirrors it into these atoms for the composer,
// status stack, and floating jump button — all of which render OUTSIDE the thread.
//
// `$threadScrollByKey` scopes the composer dim + jump button state to the chat
// surface that owns the scroll container (`main`, `tile:<stored-id>`, ...). A
// single global boolean made one split pane scrolling history dim every mounted
// composer/status stack and show every jump button.
export interface ThreadScrollState {
  jumpButtonVisible: boolean
  scrolledUp: boolean
}

export const DEFAULT_THREAD_SCROLL_KEY = 'main'
export const THREAD_SCROLL_AT_BOTTOM: ThreadScrollState = { jumpButtonVisible: false, scrolledUp: false }
export const $threadScrollByKey = atom<Record<string, ThreadScrollState>>({})

const keyOf = (key?: null | string) => key || DEFAULT_THREAD_SCROLL_KEY

export function threadScrollStateFor(
  states: Record<string, ThreadScrollState>,
  key?: null | string
): ThreadScrollState {
  return states[keyOf(key)] ?? THREAD_SCROLL_AT_BOTTOM
}

// Skip no-op writes so subscribers don't churn on every scroll tick.
export const setThreadAtBottom = (isAtBottom: boolean, key?: null | string) => {
  const stateKey = keyOf(key)
  const nextState: ThreadScrollState = { jumpButtonVisible: !isAtBottom, scrolledUp: !isAtBottom }
  const map = $threadScrollByKey.get()
  const prev = map[stateKey] ?? THREAD_SCROLL_AT_BOTTOM

  if (prev.scrolledUp === nextState.scrolledUp && prev.jumpButtonVisible === nextState.jumpButtonVisible) {
    return
  }

  $threadScrollByKey.set({ ...map, [stateKey]: nextState })
}

export const resetThreadScroll = (key?: null | string) => setThreadAtBottom(true, key)

// Cross-component bridge: the jump button lives by the composer, the viewport's
// `scrollToBottom` lives inside the thread. The bridge registers a handler; the
// button fires it. Mirrors the composer focus/insert emitter pattern.
const handlers = new Map<string, Set<() => void>>()

export const onScrollToBottomRequest = (handler: () => void, key?: null | string) => {
  const stateKey = keyOf(key)
  const set = handlers.get(stateKey) ?? new Set<() => void>()

  set.add(handler)
  handlers.set(stateKey, set)

  return () => {
    set.delete(handler)

    if (set.size === 0) {
      handlers.delete(stateKey)
    }
  }
}

export const requestScrollToBottom = (key?: null | string) => handlers.get(keyOf(key))?.forEach(handler => handler())

// Inline edit grows a sticky human bubble. Fire on pointerdown so the viewport
// escapes stick-to-bottom before focus/layout; close clears the edit flag when
// the inline composer unmounts.
const editOpenHandlers = new Set<() => void>()
const editCloseHandlers = new Set<() => void>()

export const onThreadEditOpen = (handler: () => void) => {
  editOpenHandlers.add(handler)

  return () => void editOpenHandlers.delete(handler)
}

export const notifyThreadEditOpen = () => editOpenHandlers.forEach(handler => handler())

export const onThreadEditClose = (handler: () => void) => {
  editCloseHandlers.add(handler)

  return () => void editCloseHandlers.delete(handler)
}

export const notifyThreadEditClose = () => editCloseHandlers.forEach(handler => handler())
