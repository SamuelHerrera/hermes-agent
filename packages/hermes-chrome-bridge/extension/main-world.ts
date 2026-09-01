import { runtimeChannelAuth } from './page-runtime-channel.js'
import { MAIN_REQUEST_EVENT, MAIN_RESPONSE_EVENT } from './page-runtime-client.js'
import {
  type ConsoleLevel,
  createConsoleRecorder,
  executeGuardedEval,
  RuntimeGuardError
} from './page-runtime-core.js'

const INSTALL_MARKER = '__hermesChromeBridgeMainRuntimeInstalled'
const CONSOLE_LEVELS: ConsoleLevel[] = ['debug', 'error', 'info', 'log', 'warn']

const SENSITIVE_SELECTOR = [
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

const SENSITIVE_IDENTITY = /(?:api[-_ ]?(?:key|token)|access[-_ ]?token|auth(?:orization)?|bearer|client[-_ ]?secret|credential|password|passcode|secret|token|one[-_ ]?time|2fa|otp|card|cc[-_ ]?(?:csc|cvv|exp|number)|cvv|cvc|security[-_ ]?code|expiry|expiration)/iu

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validLevels(value: unknown): value is ConsoleLevel[] {
  return Array.isArray(value) && value.length <= CONSOLE_LEVELS.length &&
    value.every(level => typeof level === 'string' && CONSOLE_LEVELS.includes(level as ConsoleLevel)) &&
    new Set(value).size === value.length
}

async function send(response: Record<string, unknown>): Promise<void> {
  window.dispatchEvent(new CustomEvent(MAIN_RESPONSE_EVENT, {
    detail: JSON.stringify({
      ...response,
      auth: await runtimeChannelAuth(response)
    })
  }))
}

function attribute(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name)

  return value === null ? undefined : value
}

function labelText(element: Element): string {
  const labels = (element as Element & { labels?: ArrayLike<Element> }).labels

  const direct = labels === undefined
    ? ''
    : Array.from(labels).map(label => label.textContent ?? '').join(' ')

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

function hasSensitiveFields(): boolean {
  if (document.querySelector(SENSITIVE_SELECTOR) !== null) { return true }

  return Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'))
    .some(element => SENSITIVE_IDENTITY.test([
      attribute(element, 'id'),
      attribute(element, 'name'),
      attribute(element, 'aria-label'),
      attribute(element, 'placeholder'),
      attribute(element, 'autocomplete'),
      labelText(element)
    ].filter((value): value is string => value !== undefined).join(' ')))
}

const runtimeWindow = window as unknown as Window & Record<string, unknown>

if (runtimeWindow[INSTALL_MARKER] !== true) {
  runtimeWindow[INSTALL_MARKER] = true
  const recorder = createConsoleRecorder()

  for (const level of CONSOLE_LEVELS) {
    const original = console[level]

    try {
      console[level] = (...arguments_: unknown[]) => {
        try { recorder.add(level, arguments_) } catch { /* Preserve the page console on hostile values. */ }

        Reflect.apply(original, console, arguments_)
      }
    } catch {
      // A page may freeze its console object; evaluation remains available.
    }
  }

  window.addEventListener(MAIN_REQUEST_EVENT, event => {
    const detail = (event as CustomEvent<unknown>).detail

    if (typeof detail !== 'string' || detail.length > 120_000) { return }

    let request: unknown

    try {
      request = JSON.parse(detail)
    } catch {
      return
    }

    if (!isRecord(request) || typeof request.id !== 'string' || request.id.length === 0 ||
      request.id.length > 100 || typeof request.kind !== 'string') {
      return
    }

    if (request.kind === 'console') {
      const levels = request.levels === undefined ? undefined : request.levels
      const limit = request.limit === undefined ? undefined : request.limit

      if ((levels !== undefined && !validLevels(levels)) ||
        (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 200))) {
        void send({
          error: { code: 'INVALID_ARGUMENTS', message: 'The console request is invalid.' },
          id: request.id,
          ok: false
        })

        return
      }

      void send({
        id: request.id,
        ok: true,
        result: recorder.list({
          ...(levels === undefined ? {} : { levels }),
          ...(limit === undefined ? {} : { limit: limit as number })
        })
      })

      return
    }

    if (request.kind !== 'eval' || typeof request.source !== 'string') { return }

    void executeGuardedEval({
      evaluate: source => Reflect.apply(window.eval, window, [source]),
      hasSensitiveFields: hasSensitiveFields(),
      source: request.source
    })
      .then(result => send({ id: request.id, ok: true, result }))
      .catch(error => {
        const guarded = error instanceof RuntimeGuardError
          ? error
          : new RuntimeGuardError('EVAL_FAILED', 'Evaluation failed.')

        void send({
          error: { code: guarded.code, message: guarded.message },
          id: request.id,
          ok: false
        })
      })
  })
}
