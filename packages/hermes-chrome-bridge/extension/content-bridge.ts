import type { ControlIndicator } from './control-indicator.js'
import { PageActionError, type PageActions } from './page-actions.js'
import { type PageInspector, PageInspectorError, type SnapshotFormat } from './page-inspector.js'
import { type PageRuntimeClient, PageRuntimeClientError } from './page-runtime-client.js'

interface ContentBridgeResult {
  error?: { code: string, message: string }
  result?: unknown
  type: 'hermes.bridge.error' | 'hermes.bridge.result'
  version: 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()

  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
}

function isFormat(value: unknown): value is SnapshotFormat {
  return value === 'accessibility' || value === 'dom' || value === 'both'
}

function validTarget(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_048
}

function validModifiers(value: unknown): value is Array<'alt' | 'ctrl' | 'meta' | 'shift'> {
  if (!Array.isArray(value) || value.length > 4) { return false }
  const allowed = new Set(['alt', 'ctrl', 'meta', 'shift'])

  return value.every(modifier => typeof modifier === 'string' && allowed.has(modifier)) &&
    new Set(value).size === value.length
}

function validDistance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000
}

function validConsoleLevels(value: unknown): value is Array<'debug' | 'error' | 'info' | 'log' | 'warn'> {
  const allowed = new Set(['debug', 'error', 'info', 'log', 'warn'])

  return Array.isArray(value) && value.length <= 5 &&
    value.every(level => typeof level === 'string' && allowed.has(level)) && new Set(value).size === value.length
}

async function runtimeResult(request: Promise<unknown>): Promise<ContentBridgeResult> {
  try {
    return { result: await request, type: 'hermes.bridge.result', version: 1 }
  } catch (error) {
    return {
      error: {
        code: error instanceof PageRuntimeClientError ? error.code : 'PAGE_RUNTIME_FAILED',
        message: error instanceof PageRuntimeClientError ? error.message : 'The page runtime request failed.'
      },
      type: 'hermes.bridge.error',
      version: 1
    }
  }
}

export function createContentBridgeHandler(
  inspector: PageInspector,
  actions: PageActions,
  indicator?: ControlIndicator,
  runtime?: PageRuntimeClient
) {
  return (message: unknown): ContentBridgeResult | Promise<ContentBridgeResult> | undefined => {
    if (!isRecord(message) || message.version !== 1) { return undefined }

    try {
      if (message.type === 'hermes.bridge.indicator') {
        if (!exactKeys(message, ['active', 'type', 'version']) || typeof message.active !== 'boolean') {
          return undefined
        }

        if (message.active) { indicator?.activity() } else { indicator?.hide() }

        return {
          result: { active: message.active },
          type: 'hermes.bridge.result',
          version: 1
        }
      }

      if (message.type === 'hermes.bridge.eval') {
        if (!exactKeys(message, ['source', 'timeoutMs', 'type', 'version']) ||
          typeof message.source !== 'string' || message.source.length === 0 || message.source.length > 100_000 ||
          !Number.isInteger(message.timeoutMs) || (message.timeoutMs as number) < 100 ||
          (message.timeoutMs as number) > 10_000) {
          return undefined
        }

        if (runtime === undefined) {
          return {
            error: { code: 'PAGE_RUNTIME_UNAVAILABLE', message: 'The page runtime is unavailable.' },
            type: 'hermes.bridge.error',
            version: 1
          }
        }

        indicator?.activity()

        return runtimeResult(runtime.eval({ source: message.source, timeoutMs: message.timeoutMs as number }))
      }

      if (message.type === 'hermes.bridge.console') {
        const validKeys = Object.keys(message).every(key =>
          key === 'levels' || key === 'limit' || key === 'timeoutMs' || key === 'type' || key === 'version'
        )

        const levels = message.levels ?? ['debug', 'error', 'info', 'log', 'warn']
        const limit = message.limit ?? 50

        if (!validKeys || !validConsoleLevels(levels) || !Number.isInteger(limit) ||
          (limit as number) < 1 || (limit as number) > 200 || !Number.isInteger(message.timeoutMs) ||
          (message.timeoutMs as number) < 100 || (message.timeoutMs as number) > 10_000) {
          return undefined
        }

        if (runtime === undefined) {
          return {
            error: { code: 'PAGE_RUNTIME_UNAVAILABLE', message: 'The page runtime is unavailable.' },
            type: 'hermes.bridge.error',
            version: 1
          }
        }

        return runtimeResult(runtime.console({
          levels,
          limit: limit as number,
          timeoutMs: message.timeoutMs as number
        }))
      }

      if (message.type === 'hermes.bridge.snapshot') {
        if (!exactKeys(message, ['format', 'type', 'version']) || !isFormat(message.format)) {
          return undefined
        }

        return {
          result: inspector.snapshot({ format: message.format }),
          type: 'hermes.bridge.result',
          version: 1
        }
      }

      if (message.type === 'hermes.bridge.query') {
        const validKeys = exactKeys(message, ['selector', 'type', 'version']) ||
          exactKeys(message, ['limit', 'selector', 'type', 'version'])

        const validLimit = message.limit === undefined ||
          (Number.isInteger(message.limit) && (message.limit as number) > 0 && (message.limit as number) <= 100)

        if (!validKeys || typeof message.selector !== 'string' || message.selector.length === 0 ||
          message.selector.length > 2_048 || !validLimit) {
          return undefined
        }

        return {
          result: inspector.query({
            ...(message.limit === undefined ? {} : { limit: message.limit as number }),
            selector: message.selector
          }),
          type: 'hermes.bridge.result',
          version: 1
        }
      }

      if (message.type === 'hermes.bridge.click') {
        if (!exactKeys(message, ['button', 'target', 'type', 'version']) || !validTarget(message.target) ||
          (message.button !== 'left' && message.button !== 'middle' && message.button !== 'right')) {
          return undefined
        }

        return {
          result: actions.click({ button: message.button, target: message.target }),
          type: 'hermes.bridge.result',
          version: 1
        }
      }

      if (message.type === 'hermes.bridge.type') {
        if (!exactKeys(message, ['submit', 'target', 'text', 'type', 'version']) ||
          !validTarget(message.target) || typeof message.text !== 'string' || message.text.length > 100_000 ||
          typeof message.submit !== 'boolean') {
          return undefined
        }

        return {
          result: actions.type({ submit: message.submit, target: message.target, text: message.text }),
          type: 'hermes.bridge.result',
          version: 1
        }
      }

      if (message.type === 'hermes.bridge.key') {
        if (!exactKeys(message, ['key', 'modifiers', 'type', 'version']) ||
          typeof message.key !== 'string' || message.key.length === 0 || message.key.length > 64 ||
          !validModifiers(message.modifiers)) {
          return undefined
        }

        return {
          result: actions.key({ key: message.key, modifiers: message.modifiers }),
          type: 'hermes.bridge.result',
          version: 1
        }
      }

      if (message.type === 'hermes.bridge.scroll') {
        const validKeys = exactKeys(message, ['deltaX', 'deltaY', 'type', 'version']) ||
          exactKeys(message, ['deltaX', 'deltaY', 'target', 'type', 'version'])

        if (!validKeys || !validDistance(message.deltaX) || !validDistance(message.deltaY) ||
          (message.target !== undefined && !validTarget(message.target))) {
          return undefined
        }

        return {
          result: actions.scroll({
            deltaX: message.deltaX,
            deltaY: message.deltaY,
            ...(message.target === undefined ? {} : { target: message.target })
          }),
          type: 'hermes.bridge.result',
          version: 1
        }
      }

      if (message.type === 'hermes.bridge.hover') {
        if (!exactKeys(message, ['target', 'type', 'version']) || !validTarget(message.target)) {
          return undefined
        }

        return {
          result: actions.hover({ target: message.target }),
          type: 'hermes.bridge.result',
          version: 1
        }
      }
    } catch (error) {
      return {
        error: {
          code: error instanceof PageInspectorError || error instanceof PageActionError
            ? error.code
            : 'PAGE_OPERATION_FAILED',
          message: error instanceof PageInspectorError || error instanceof PageActionError
            ? error.message
            : 'The page operation failed.'
        },
        type: 'hermes.bridge.error',
        version: 1
      }
    }

    return undefined
  }
}
