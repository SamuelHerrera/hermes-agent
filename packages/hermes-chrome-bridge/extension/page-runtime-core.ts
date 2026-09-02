export type ConsoleLevel = 'debug' | 'error' | 'info' | 'log' | 'warn'

export class RuntimeGuardError extends Error {
  public constructor(
    public readonly code: 'EVAL_FAILED' | 'RESULT_TOO_LARGE' | 'SENSITIVE_PAGE' | 'SOURCE_TOO_LARGE',
    message: string
  ) {
    super(message)
    this.name = 'RuntimeGuardError'
  }
}

export interface ConsoleEntry {
  arguments: unknown[]
  level: ConsoleLevel
  sequence: number
}

export interface ConsoleRecorder {
  add(level: ConsoleLevel, arguments_: unknown[]): void
  list(options: { levels?: ConsoleLevel[], limit?: number }): {
    count: number
    entries: ConsoleEntry[]
    truncated: boolean
  }
}

const ASSIGNED_SECRET = /\b(?:api[-_ ]?key|authorization|bearer|password|secret|token)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/giu
const CARD = /\b(?:\d[ -]*?){13,19}\b/gu
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const PREFIXED_TOKEN = /\b(?:gh[pousr]_|sk[-_](?:live|test)[-_]|eyJ)[A-Za-z0-9._~-]{8,}/gu
const SENSITIVE_KEY = /(?:api.?key|authorization|cookie|credential|password|secret|session|token)/iu
const MAX_RESULT_BYTES = 256 * 1024
const MAX_SOURCE_LENGTH = 100_000
const MAX_STRING_LENGTH = 10_000

function redactString(value: string): string {
  const normalized = [...value]
    .filter(character => {
      const code = character.charCodeAt(0)

      return code > 31 && code !== 127
    })
    .join('')

  let redacted = normalized

  for (const pattern of [ASSIGNED_SECRET, CARD, EMAIL, PREFIXED_TOKEN]) {
    pattern.lastIndex = 0
    redacted = redacted.replace(pattern, '[redacted]')
  }

  return redacted.length <= MAX_STRING_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_STRING_LENGTH - 1)}…`
}

function sanitize(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  key?: string
): unknown {
  if (key !== undefined && SENSITIVE_KEY.test(key)) { return '[redacted]' }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') { return value }

  if (typeof value === 'string') { return redactString(value) }

  if (typeof value === 'bigint') { return value.toString() }

  if (typeof value === 'undefined') { return null }

  if (typeof value === 'function' || typeof value === 'symbol') { return `[${typeof value}]` }

  if (depth >= 6) { return '[max-depth]' }

  if (typeof value !== 'object') { return String(value) }

  if (seen.has(value)) { return '[circular]' }

  seen.add(value)

  if (value instanceof Error) {
    return {
      message: redactString(value.message),
      name: redactString(value.name)
    }
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map(item => sanitize(item, depth + 1, seen))
  }

  const result: Record<string, unknown> = {}

  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 100)) {
    result[redactString(entryKey).slice(0, 200)] = sanitize(entryValue, depth + 1, seen, entryKey)
  }

  return result
}

export function sanitizeRuntimeValue(value: unknown): unknown {
  return sanitize(value, 0, new WeakSet())
}

export async function executeGuardedEval(options: {
  evaluate(source: string): unknown | Promise<unknown>
  hasSensitiveFields: boolean
  maxResultBytes?: number
  source: string
}): Promise<unknown> {
  if (options.source.length === 0 || options.source.length > MAX_SOURCE_LENGTH) {
    throw new RuntimeGuardError('SOURCE_TOO_LARGE', 'The JavaScript source is empty or exceeds the size limit.')
  }

  if (options.hasSensitiveFields) {
    throw new RuntimeGuardError('SENSITIVE_PAGE', 'JavaScript evaluation is blocked on pages with sensitive fields.')
  }

  let value: unknown

  try {
    value = await options.evaluate(options.source)
  } catch (error) {
    const message = error instanceof Error ? redactString(error.message) : 'Evaluation failed.'

    throw new RuntimeGuardError('EVAL_FAILED', message || 'Evaluation failed.')
  }

  const sanitized = sanitizeRuntimeValue(value)
  const encoded = new TextEncoder().encode(JSON.stringify(sanitized))

  if (encoded.length > Math.min(MAX_RESULT_BYTES, options.maxResultBytes ?? MAX_RESULT_BYTES)) {
    throw new RuntimeGuardError('RESULT_TOO_LARGE', 'The JavaScript result exceeds the size limit.')
  }

  return sanitized
}

export function createConsoleRecorder(maxEntries = 200): ConsoleRecorder {
  const maximum = Math.max(1, Math.min(200, maxEntries))
  const entries: ConsoleEntry[] = []
  let sequence = 0

  return {
    add(level, arguments_) {
      entries.push({
        arguments: arguments_.slice(0, 20).map(argument => sanitizeRuntimeValue(argument)),
        level,
        sequence: ++sequence
      })

      if (entries.length > maximum) { entries.splice(0, entries.length - maximum) }
    },

    list({ levels, limit }) {
      const allowed = levels === undefined ? undefined : new Set(levels)
      const filtered = entries.filter(entry => allowed === undefined || allowed.has(entry.level))
      const maximumResults = Math.max(1, Math.min(200, limit ?? 50))
      const selected = filtered.slice(-maximumResults)

      return {
        count: selected.length,
        entries: selected,
        truncated: filtered.length > selected.length
      }
    }
  }
}
