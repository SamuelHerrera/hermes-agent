import type { ConsoleLevel } from './page-runtime-core.js'

export class PageRuntimeServiceError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'PageRuntimeServiceError'
  }
}

export interface PageRuntimeService {
  console(tabId: number, options: { levels?: ConsoleLevel[], limit?: number }): Promise<unknown>
  eval(tabId: number, options: { source: string, timeoutMs: number }): Promise<unknown>
}

interface ScriptErrorResult {
  __hermesChromeBridgeError: { code: string, message: string }
}

interface ScriptSuccessResult {
  __hermesChromeBridgeResult: unknown
}

const RUNTIME_TIMEOUT_CODE = 'RUNTIME_TIMEOUT'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unwrapScriptResult(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.__hermesChromeBridgeError) &&
    typeof value.__hermesChromeBridgeError.code === 'string' &&
    typeof value.__hermesChromeBridgeError.message === 'string') {
    throw new PageRuntimeServiceError(
      value.__hermesChromeBridgeError.code.slice(0, 80),
      value.__hermesChromeBridgeError.message.slice(0, 500)
    )
  }

  if (isRecord(value) && Object.hasOwn(value, '__hermesChromeBridgeResult')) {
    return value.__hermesChromeBridgeResult
  }

  throw new PageRuntimeServiceError('INVALID_RUNTIME_RESPONSE', 'The page runtime response is invalid.')
}

function timeoutAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new PageRuntimeServiceError(RUNTIME_TIMEOUT_CODE, 'The page runtime request timed out.'))
    }, Math.max(100, Math.min(10_000, timeoutMs)))
  })
}

export function createPageRuntimeService(): PageRuntimeService {
  async function execute(
    tabId: number,
    function_: (...arguments_: never[]) => unknown,
    args: unknown[],
    timeoutMs: number
  ): Promise<unknown> {
    let result

    try {
      result = await Promise.race([
        chrome.scripting.executeScript({
          args,
          func: function_ as never,
          target: { tabId },
          world: 'MAIN'
        }),
        timeoutAfter(timeoutMs)
      ])
    } catch (error) {
      if (error instanceof PageRuntimeServiceError) {
        throw error
      }

      throw new PageRuntimeServiceError('PAGE_RUNTIME_FAILED', 'The page runtime request failed.')
    }

    if (result.length !== 1) {
      throw new PageRuntimeServiceError('INVALID_RUNTIME_RESPONSE', 'The page runtime response is invalid.')
    }

    return unwrapScriptResult(result[0]?.result)
  }

  return {
    console: async (tabId, options) => execute(tabId, function runtimeConsole(levels: never, limit: never): ScriptErrorResult | ScriptSuccessResult {
      const selectedInputLevels = levels as ConsoleLevel[] | undefined
      const selectedInputLimit = limit as number | undefined

      const runtimeWindow = window as unknown as Window & {
        __hermesChromeBridgeConsoleEntries?: Array<{ arguments: unknown[], level: ConsoleLevel, sequence: number }>
        __hermesChromeBridgeConsoleInstalled?: boolean
        __hermesChromeBridgeConsoleSequence?: number
      }

      const allowedLevels: ConsoleLevel[] = ['debug', 'error', 'info', 'log', 'warn']

      const redactString = (value: string): string => {
        const patterns = [
          /\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:orization)?|bearer|client[-_ ]?secret|credential|password|refresh[-_ ]?token|secret|session[-_ ]?token|token)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/giu,
          /\bbearer\s+[A-Za-z0-9._~-]+/giu,
          /\b(?:\d[ -]*?){13,19}\b/gu,
          /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
          /\b(?:gh[pousr]_|sk[-_](?:live|test)[-_]|eyJ)[A-Za-z0-9._~-]{8,}/gu
        ]

        let redacted = value

        for (const pattern of patterns) {
          redacted = redacted.replace(pattern, '[redacted]')
        }

        return redacted.slice(0, 10_000)
      }

      const sanitize = (value: unknown, depth = 0): unknown => {
        if (value === null || typeof value === 'boolean' || typeof value === 'number') { return value }

        if (typeof value === 'string') { return redactString(value) }

        if (typeof value === 'bigint') { return value.toString() }

        if (typeof value === 'undefined') { return null }

        if (typeof value === 'function' || typeof value === 'symbol') { return `[${typeof value}]` }

        if (depth >= 4 || typeof value !== 'object') { return String(value) }

        if (Array.isArray(value)) { return value.slice(0, 50).map(item => sanitize(item, depth + 1)) }
        const output: Record<string, unknown> = {}

        for (const [key, entry] of Object.entries(value).slice(0, 50)) {
          output[redactString(key).slice(0, 200)] = /(?:api.?key|authorization|cookie|credential|password|secret|session|token)/iu.test(key)
            ? '[redacted]'
            : sanitize(entry, depth + 1)
        }

        return output
      }

      if (runtimeWindow.__hermesChromeBridgeConsoleInstalled !== true) {
        runtimeWindow.__hermesChromeBridgeConsoleInstalled = true
        runtimeWindow.__hermesChromeBridgeConsoleEntries = []
        runtimeWindow.__hermesChromeBridgeConsoleSequence = 0

        for (const level of allowedLevels) {
          const original = console[level]

          try {
            console[level] = (...arguments_: unknown[]) => {
              const entries = runtimeWindow.__hermesChromeBridgeConsoleEntries ?? []
              const sequence = (runtimeWindow.__hermesChromeBridgeConsoleSequence ?? 0) + 1
              runtimeWindow.__hermesChromeBridgeConsoleSequence = sequence
              entries.push({
                arguments: arguments_.slice(0, 20).map(argument => sanitize(argument)),
                level,
                sequence
              })

              if (entries.length > 200) { entries.splice(0, entries.length - 200) }
              runtimeWindow.__hermesChromeBridgeConsoleEntries = entries
              Reflect.apply(original, console, arguments_)
            }
          } catch {
            // Preserve page behavior when console is frozen.
          }
        }
      }

      const selectedLevels = selectedInputLevels === undefined ? allowedLevels : selectedInputLevels
      const selectedLimit = Math.max(1, Math.min(200, selectedInputLimit ?? 50))

      const entries = (runtimeWindow.__hermesChromeBridgeConsoleEntries ?? [])
        .filter(entry => selectedLevels.includes(entry.level))

      const selected = entries.slice(-selectedLimit)

      return {
        __hermesChromeBridgeResult: {
          count: selected.length,
          entries: selected,
          truncated: entries.length > selected.length
        }
      }
    }, [options.levels, options.limit], 2_000),
    eval: async (tabId, options) => execute(tabId, async function runtimeEval(sourceInput: never): Promise<ScriptErrorResult | ScriptSuccessResult> {
      const source = sourceInput as string

      const sensitiveSelector = [
        'input[type="password"]',
        'textarea[name*="password" i]',
        'textarea[id*="password" i]',
        'input[autocomplete~="current-password" i]',
        'input[autocomplete~="new-password" i]',
        'input[autocomplete~="one-time-code" i]',
        'input[autocomplete^="cc-" i]',
        'input[name*="api_key" i]',
        'input[name*="api-key" i]',
        'input[name*="access_token" i]',
        'input[name*="access-token" i]',
        'input[name*="client_secret" i]',
        'input[name*="client-secret" i]',
        'input[name*="card" i]',
        'input[name*="cvv" i]',
        'input[name*="cvc" i]'
      ].join(',')

      const sensitiveIdentity = /(?:api[-_ ]?(?:key|token)|access[-_ ]?token|auth(?:orization)?|bearer|client[-_ ]?secret|credential|password|passcode|secret|token|one[-_ ]?time|2fa|otp|card|cc[-_ ]?(?:csc|cvv|exp|number)|cvv|cvc|security[-_ ]?code|expiry|expiration)/iu
      const attribute = (element: Element, name: string): string | undefined => element.getAttribute(name) ?? undefined

      const labelText = (element: Element): string => {
        const labels = (element as Element & { labels?: ArrayLike<Element> }).labels
        const direct = labels === undefined ? '' : Array.from(labels).map(label => label.textContent ?? '').join(' ')
        const ids = attribute(element, 'aria-labelledby')?.split(/\s+/u).filter(Boolean) ?? []
        const labelledBy = ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ')
        const id = attribute(element, 'id')

        const explicit = id === undefined
          ? ''
          : Array.from(document.querySelectorAll('label[for]'))
            .filter(label => label.getAttribute('for') === id)
            .map(label => label.textContent ?? '')
            .join(' ')

        const wrapping = element.closest('label')?.textContent ?? ''

        return `${direct} ${labelledBy} ${explicit} ${wrapping}`
      }

      const hasSensitiveFields = document.querySelector(sensitiveSelector) !== null ||
        Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'))
          .some(element => sensitiveIdentity.test([
            attribute(element, 'id'),
            attribute(element, 'name'),
            attribute(element, 'aria-label'),
            attribute(element, 'placeholder'),
            attribute(element, 'autocomplete'),
            labelText(element)
          ].filter((value): value is string => value !== undefined).join(' ')))

      if (hasSensitiveFields) {
        return {
          __hermesChromeBridgeError: {
            code: 'SENSITIVE_PAGE',
            message: 'JavaScript evaluation is blocked on pages with sensitive fields.'
          }
        }
      }

      try {
        const value = await Reflect.apply(window.eval, window, [source])

        const redactString = (entry: string): string => {
          const patterns = [
            /\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:orization)?|bearer|client[-_ ]?secret|credential|password|refresh[-_ ]?token|secret|session[-_ ]?token|token)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/giu,
            /\bbearer\s+[A-Za-z0-9._~-]+/giu,
            /\b(?:\d[ -]*?){13,19}\b/gu,
            /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
            /\b(?:gh[pousr]_|sk[-_](?:live|test)[-_]|eyJ)[A-Za-z0-9._~-]{8,}/gu
          ]

          let redacted = entry

          for (const pattern of patterns) {
            redacted = redacted.replace(pattern, '[redacted]')
          }

          return redacted.slice(0, 10_000)
        }

        const sanitized = JSON.parse(JSON.stringify(value, (key, entry) => (
          /(?:api.?key|authorization|cookie|credential|password|secret|session|token)/iu.test(key)
            ? '[redacted]'
            : typeof entry === 'string'
              ? redactString(entry)
            : entry
        ))) as unknown

        const encoded = new TextEncoder().encode(JSON.stringify(sanitized))

        if (encoded.length > 256 * 1024) {
          return { __hermesChromeBridgeError: { code: 'RESULT_TOO_LARGE', message: 'The JavaScript result exceeds the size limit.' } }
        }

        return { __hermesChromeBridgeResult: sanitized }
      } catch {
        return { __hermesChromeBridgeError: { code: 'EVAL_FAILED', message: 'Evaluation failed.' } }
      }
    }, [options.source], options.timeoutMs)
  }
}
