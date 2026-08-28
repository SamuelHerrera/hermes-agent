import assert from 'node:assert/strict'

import { test } from 'vitest'

import { dispatchNotificationAction, nativeNotificationDedupeKey } from './native-notification-routing'

test('distinct request ids produce distinct notification dedupe keys', () => {
  const first = nativeNotificationDedupeKey({ kind: 'approval', requestId: 'approval-a', sessionId: 'session-1' })
  const second = nativeNotificationDedupeKey({ kind: 'approval', requestId: 'approval-b', sessionId: 'session-1' })

  assert.notEqual(first, second)
})

test('duplicate notifications without request ids retain the same key', () => {
  const first = nativeNotificationDedupeKey({ kind: 'turnDone', sessionId: 'session-1' })
  const second = nativeNotificationDedupeKey({ kind: 'turnDone', sessionId: 'session-1' })

  assert.equal(first, second)
})

test('notification actions are sent only to the originating renderer', () => {
  const sent: unknown[][] = []
  const unrelated: unknown[][] = []

  const origin = {
    isDestroyed: () => false,
    send: (...args: unknown[]) => sent.push(args)
  }

  const otherRenderer = {
    isDestroyed: () => false,
    send: (...args: unknown[]) => unrelated.push(args)
  }

  const delivered = dispatchNotificationAction(
    origin,
    { kind: 'approval', requestId: 'approval-a', sessionId: 'session-1' },
    'approve'
  )

  assert.equal(delivered, true)
  assert.deepEqual(sent, [
    ['hermes:notification-action', { actionId: 'approve', requestId: 'approval-a', sessionId: 'session-1' }]
  ])
  assert.deepEqual(unrelated, [])
  assert.equal(otherRenderer.isDestroyed(), false)
})

test('notification actions fail closed when the originating renderer is gone', () => {
  const sent: unknown[][] = []

  const origin = {
    isDestroyed: () => true,
    send: (...args: unknown[]) => sent.push(args)
  }

  assert.equal(
    dispatchNotificationAction(origin, { kind: 'approval', requestId: 'approval-a', sessionId: 'session-1' }, 'approve'),
    false
  )
  assert.deepEqual(sent, [])
})
