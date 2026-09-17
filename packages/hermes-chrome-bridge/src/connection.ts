// Public routing identities, never credentials or Chrome account identifiers.
export interface ConnectionIdentity {
  connectionId: string
  label: string
}

export const CONNECTION_ID_PATTERN = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
const CONNECTION_ID = new RegExp(`^${CONNECTION_ID_PATTERN}$`, 'u')
const TAB_ID = new RegExp(`^(${CONNECTION_ID_PATTERN}):(${CONNECTION_ID_PATTERN}):([1-9][0-9]*)$`, 'u')

export function validConnectionId(value: unknown): value is string {
  return typeof value === 'string' && CONNECTION_ID.test(value)
}

export function parseTabId(value: unknown): { connectionId: string, sessionId: string, tabId: number } | undefined {
  if (typeof value !== 'string') { return undefined }
  const match = TAB_ID.exec(value)

  if (match === null || !Number.isSafeInteger(Number(match[3]))) { return undefined }

  return { connectionId: match[1]!, sessionId: match[2]!, tabId: Number(match[3]) }
}

export function safeConnectionLabel(value: unknown, connectionId: string): string {
  // Labels are explicitly public nicknames. Never infer them from account data.
  if (typeof value !== 'string' || value.length > 64 ||
    !/^[\p{L}\p{N} _.-]{1,64}$/u.test(value) ||
    /(?:password|secret|token|bearer|api.?key|gh[pousr]_|sk[-_]|eyJ)|[A-Za-z0-9_-]{20,}|\d{13}/iu.test(value)) {
    return `Chrome ${connectionId.slice(0, 8)}`
  }

  return value.trim() || `Chrome ${connectionId.slice(0, 8)}`
}
