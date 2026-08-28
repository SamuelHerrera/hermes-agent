export interface NativeNotificationIdentity {
  kind: string
  requestId?: string
  sessionId?: string
  tag?: string
}

export interface NotificationRenderer {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export function nativeNotificationDedupeKey(input: NativeNotificationIdentity): string {
  return `${input.kind}:${input.sessionId ?? ''}:${input.tag ?? ''}:${input.requestId ?? ''}`
}

export function dispatchNotificationAction(
  origin: NotificationRenderer,
  payload: NativeNotificationIdentity,
  actionId: string
): boolean {
  if (origin.isDestroyed()) {
    return false
  }

  origin.send('hermes:notification-action', {
    actionId,
    requestId: payload.requestId,
    sessionId: payload.sessionId
  })

  return true
}
