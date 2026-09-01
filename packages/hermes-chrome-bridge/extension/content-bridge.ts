import { type PageInspector, PageInspectorError, type SnapshotFormat } from './page-inspector.js'

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

export function createContentBridgeHandler(inspector: PageInspector) {
  return (message: unknown): ContentBridgeResult | undefined => {
    if (!isRecord(message) || message.version !== 1) { return undefined }

    try {
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
    } catch (error) {
      return {
        error: {
          code: error instanceof PageInspectorError ? error.code : 'PAGE_INSPECTION_FAILED',
          message: error instanceof PageInspectorError
            ? error.message
            : 'The page inspection request failed.'
        },
        type: 'hermes.bridge.error',
        version: 1
      }
    }

    return undefined
  }
}
