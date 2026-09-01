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
  'input[autocomplete~="current-password" i]',
  'input[autocomplete~="new-password" i]',
  'input[autocomplete~="one-time-code" i]',
  'input[autocomplete^="cc-" i]',
  'input[name*="card" i]',
  'input[name*="cvv" i]',
  'input[name*="cvc" i]'
].join(',')

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validLevels(value: unknown): value is ConsoleLevel[] {
  return Array.isArray(value) && value.length <= CONSOLE_LEVELS.length &&
    value.every(level => typeof level === 'string' && CONSOLE_LEVELS.includes(level as ConsoleLevel)) &&
    new Set(value).size === value.length
}

function send(response: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(MAIN_RESPONSE_EVENT, {
    detail: JSON.stringify(response)
  }))
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
        send({
          error: { code: 'INVALID_ARGUMENTS', message: 'The console request is invalid.' },
          id: request.id,
          ok: false
        })

        return
      }

      send({
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
      hasSensitiveFields: document.querySelector(SENSITIVE_SELECTOR) !== null,
      source: request.source
    })
      .then(result => send({ id: request.id, ok: true, result }))
      .catch(error => {
        const guarded = error instanceof RuntimeGuardError
          ? error
          : new RuntimeGuardError('EVAL_FAILED', 'Evaluation failed.')

        send({
          error: { code: guarded.code, message: guarded.message },
          id: request.id,
          ok: false
        })
      })
  })
}
