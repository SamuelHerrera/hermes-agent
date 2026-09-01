import type { ConnectionStatus } from './lifecycle.js'
import { type PageRuntimeService, PageRuntimeServiceError } from './page-runtime-service.js'
import type { NativeRequest, NativeResponse } from './protocol.js'
import { ScreenshotError, type ScreenshotService } from './screenshot-service.js'
import { TabActionError, type TabActions } from './tab-actions.js'
import { type TabService, TabServiceError } from './tab-service.js'

interface DispatcherDependencies {
  getConnectionState(): ConnectionStatus
  pageRuntimeService?: PageRuntimeService
  screenshotService: ScreenshotService
  sendTabMessage(tabId: number, message: unknown): Promise<unknown>
  tabActions: TabActions
  tabService: TabService
}

class PageRequestError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'PageRequestError'
  }
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()

  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function error(id: string, code: string, message: string): NativeResponse {
  return { error: { code, message }, id, type: 'response' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function snapshotArguments(arguments_: Record<string, unknown>): {
  format: 'accessibility' | 'both' | 'dom'
  tabId?: number
} | undefined {
  const validKeys = Object.keys(arguments_).every(key => key === 'format' || key === 'tabId')
  const format = arguments_.format ?? 'both'

  if (!validKeys || (format !== 'accessibility' && format !== 'dom' && format !== 'both') ||
    (arguments_.tabId !== undefined && !isPositiveInteger(arguments_.tabId))) {
    return undefined
  }

  return {
    format,
    ...(arguments_.tabId === undefined ? {} : { tabId: arguments_.tabId as number })
  }
}

function queryArguments(arguments_: Record<string, unknown>): {
  limit?: number
  selector: string
  tabId: number
} | undefined {
  const validKeys = Object.keys(arguments_).every(key => key === 'limit' || key === 'selector' || key === 'tabId')

  const validLimit = arguments_.limit === undefined ||
    (Number.isInteger(arguments_.limit) && (arguments_.limit as number) > 0 && (arguments_.limit as number) <= 100)

  if (!validKeys || !isPositiveInteger(arguments_.tabId) || typeof arguments_.selector !== 'string' ||
    arguments_.selector.length === 0 || arguments_.selector.length > 2_048 || !validLimit) {
    return undefined
  }

  return {
    ...(arguments_.limit === undefined ? {} : { limit: arguments_.limit as number }),
    selector: arguments_.selector,
    tabId: arguments_.tabId
  }
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

function validConsoleLevels(value: unknown): value is Array<'debug' | 'error' | 'info' | 'log' | 'warn'> {
  const allowed = new Set(['debug', 'error', 'info', 'log', 'warn'])

  return Array.isArray(value) && value.length <= 5 &&
    value.every(level => typeof level === 'string' && allowed.has(level)) && new Set(value).size === value.length
}

function validDistance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000
}

const PAGE_ELEMENT_KEYS = new Set([
  'boundingBox', 'checked', 'disabled', 'expanded', 'name', 'ref', 'role', 'selected',
  'sensitive', 'tag', 'text', 'value'
])

const MAX_PAGE_ELEMENTS = 500
const MAX_PAGE_TEXT = 240
const MAX_PAGE_COORDINATE = 100_000_000
const PAGE_ROLE = /^[a-z][a-z0-9-]{0,63}(?:\s+[a-z][a-z0-9-]{0,63})*$/u
const PAGE_TAG = /^[a-z][a-z0-9-]{0,63}$/u
const PAGE_REF = /^e[1-9]\d{0,15}$/u

function validBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PAGE_TEXT
}

function validOptionalBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === 'boolean'
}

function validBoundingBox(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ['height', 'width', 'x', 'y'])) { return false }

  return ['height', 'width', 'x', 'y'].every(key =>
    typeof value[key] === 'number' && Number.isFinite(value[key]) &&
    Math.abs(value[key] as number) <= MAX_PAGE_COORDINATE
  ) && (value.height as number) >= 0 && (value.width as number) >= 0
}

function validPageElement(value: unknown): boolean {
  if (!isRecord(value) || !Object.keys(value).every(key => PAGE_ELEMENT_KEYS.has(key)) ||
    !validBoundingBox(value.boundingBox) || typeof value.ref !== 'string' || !PAGE_REF.test(value.ref) ||
    !validOptionalBoolean(value, 'checked') || !validOptionalBoolean(value, 'disabled') ||
    !validOptionalBoolean(value, 'expanded') || !validOptionalBoolean(value, 'selected') ||
    !validOptionalBoolean(value, 'sensitive')) {
    return false
  }

  if ((value.name !== undefined && !validBoundedString(value.name)) ||
    (value.text !== undefined && !validBoundedString(value.text)) ||
    (value.value !== undefined && !validBoundedString(value.value)) ||
    (value.role !== undefined && (typeof value.role !== 'string' || !PAGE_ROLE.test(value.role))) ||
    (value.tag !== undefined && (typeof value.tag !== 'string' || !PAGE_TAG.test(value.tag)))) {
    return false
  }

  return value.sensitive !== true ||
    (value.name === undefined && value.text === undefined && value.value === '[redacted]')
}

function validPageInspectionResult(value: unknown, expectedFormat: 'accessibility' | 'both' | 'dom'): boolean {
  if (!isRecord(value) || !exactKeys(value, ['count', 'elements', 'format', 'truncated', 'version']) ||
    !Number.isInteger(value.count) || (value.count as number) < 0 || (value.count as number) > MAX_PAGE_ELEMENTS ||
    !Array.isArray(value.elements) || value.elements.length !== value.count || value.elements.length > MAX_PAGE_ELEMENTS ||
    value.format !== expectedFormat || typeof value.truncated !== 'boolean' || value.version !== 1) {
    return false
  }

  return value.elements.every(validPageElement)
}

async function pageResult(
  dependencies: DispatcherDependencies,
  tabId: number,
  message: Record<string, unknown>
): Promise<unknown> {
  await dependencies.tabService.assertControllable(tabId)

  let response: unknown

  try {
    response = await dependencies.sendTabMessage(tabId, message)
  } catch {
    throw new PageRequestError('TAB_UNREACHABLE', 'The selected tab could not be reached.')
  }

  if (!isRecord(response) || response.version !== 1) {
    throw new PageRequestError('INVALID_PAGE_RESPONSE', 'The selected tab returned an invalid response.')
  }

  if (response.type === 'hermes.bridge.result' && exactKeys(response, ['result', 'type', 'version'])) {
    return response.result
  }

  if (response.type === 'hermes.bridge.error' && exactKeys(response, ['error', 'type', 'version']) &&
    isRecord(response.error) && exactKeys(response.error, ['code', 'message']) &&
    typeof response.error.code === 'string' && typeof response.error.message === 'string') {
    throw new PageRequestError(response.error.code, response.error.message)
  }

  throw new PageRequestError('INVALID_PAGE_RESPONSE', 'The selected tab returned an invalid response.')
}

function runtimeError(id: string, error_: unknown): NativeResponse {
  if (error_ instanceof PageRuntimeServiceError) {
    return error(id, error_.code, error_.message)
  }

  return error(id, 'PAGE_RUNTIME_FAILED', 'The page runtime request failed.')
}

async function pageInspectionResult(
  dependencies: DispatcherDependencies,
  tabId: number,
  message: Record<string, unknown>,
  expectedFormat: 'accessibility' | 'both' | 'dom'
): Promise<unknown> {
  const result = await pageResult(dependencies, tabId, message)

  if (!validPageInspectionResult(result, expectedFormat)) {
    throw new PageRequestError('INVALID_PAGE_RESPONSE', 'The selected tab returned an invalid response.')
  }

  return result
}

export function createBridgeRequestDispatcher(dependencies: DispatcherDependencies) {
  return async (request: NativeRequest): Promise<NativeResponse> => {
    try {
      if (request.method === 'status') {
        if (!exactKeys(request.arguments, [])) {
          return error(request.id, 'INVALID_ARGUMENTS', 'status does not accept arguments.')
        }

        const connected = dependencies.getConnectionState() === 'connected'

        return {
          id: request.id,
          result: {
            bridgeConnected: connected,
            nativeConnected: connected,
            ...(dependencies.tabService.getSelectedTabId() === undefined
              ? {}
              : { selectedTabId: dependencies.tabService.getSelectedTabId() })
          },
          type: 'response'
        }
      }

      if (request.method === 'tabs') {
        if (!exactKeys(request.arguments, [])) {
          return error(request.id, 'INVALID_ARGUMENTS', 'tabs does not accept arguments.')
        }

        return {
          id: request.id,
          result: {
            bridgeConnected: true,
            nativeConnected: dependencies.getConnectionState() === 'connected',
            ...await dependencies.tabService.list()
          },
          type: 'response'
        }
      }

      if (request.method === 'selectTab') {
        if (!exactKeys(request.arguments, ['tabId']) ||
          !Number.isInteger(request.arguments.tabId) ||
          (request.arguments.tabId as number) <= 0) {
          return error(
            request.id,
            'INVALID_ARGUMENTS',
            'selectTab requires exactly one positive integer tabId.'
          )
        }

        return {
          id: request.id,
          result: await dependencies.tabService.select(request.arguments.tabId as number),
          type: 'response'
        }
      }

      if (request.method === 'snapshot') {
        const arguments_ = snapshotArguments(request.arguments)

        if (arguments_ === undefined) {
          return error(request.id, 'INVALID_ARGUMENTS', 'snapshot accepts an optional positive tabId and valid format.')
        }

        const tabId = arguments_.tabId ?? dependencies.tabService.getSelectedTabId()

        if (tabId === undefined) {
          return error(request.id, 'NO_TAB_SELECTED', 'No controllable tab is selected.')
        }

        return {
          id: request.id,
          result: await pageInspectionResult(dependencies, tabId, {
            format: arguments_.format,
            type: 'hermes.bridge.snapshot',
            version: 1
          }, arguments_.format),
          type: 'response'
        }
      }

      if (request.method === 'query') {
        const arguments_ = queryArguments(request.arguments)

        if (arguments_ === undefined) {
          return error(request.id, 'INVALID_ARGUMENTS', 'query requires tabId, selector, and an optional limit from 1 to 100.')
        }

        return {
          id: request.id,
          result: await pageInspectionResult(dependencies, arguments_.tabId, {
            ...(arguments_.limit === undefined ? {} : { limit: arguments_.limit }),
            selector: arguments_.selector,
            type: 'hermes.bridge.query',
            version: 1
          }, 'both'),
          type: 'response'
        }
      }

      if (request.method === 'open') {
        const validKeys = Object.keys(request.arguments).every(key => key === 'active' || key === 'url')
        const active = request.arguments.active ?? true

        if (!validKeys || typeof active !== 'boolean' ||
          (request.arguments.url !== undefined &&
            (typeof request.arguments.url !== 'string' || request.arguments.url.length > 8_192))) {
          return error(request.id, 'INVALID_ARGUMENTS', 'open accepts an optional URL and boolean active flag.')
        }

        return {
          id: request.id,
          result: await dependencies.tabActions.open({
            active,
            ...(request.arguments.url === undefined ? {} : { url: request.arguments.url as string })
          }),
          type: 'response'
        }
      }

      if (request.method === 'navigate') {
        if (!exactKeys(request.arguments, ['tabId', 'url']) || !isPositiveInteger(request.arguments.tabId) ||
          typeof request.arguments.url !== 'string' || request.arguments.url.length === 0 ||
          request.arguments.url.length > 8_192) {
          return error(request.id, 'INVALID_ARGUMENTS', 'navigate requires a positive tabId and bounded URL.')
        }

        return {
          id: request.id,
          result: await dependencies.tabActions.navigate({
            tabId: request.arguments.tabId,
            url: request.arguments.url
          }),
          type: 'response'
        }
      }

      if (request.method === 'focus' || request.method === 'close') {
        if (!exactKeys(request.arguments, ['tabId']) || !isPositiveInteger(request.arguments.tabId)) {
          return error(request.id, 'INVALID_ARGUMENTS', `${request.method} requires exactly one positive tabId.`)
        }

        const result = request.method === 'focus'
          ? await dependencies.tabActions.focus({ tabId: request.arguments.tabId })
          : await dependencies.tabActions.close({ tabId: request.arguments.tabId })

        return { id: request.id, result, type: 'response' }
      }

      if (request.method === 'click') {
        const validKeys = exactKeys(request.arguments, ['tabId', 'target']) ||
          exactKeys(request.arguments, ['button', 'tabId', 'target'])

        const button = request.arguments.button ?? 'left'

        if (!validKeys || !isPositiveInteger(request.arguments.tabId) || !validTarget(request.arguments.target) ||
          (button !== 'left' && button !== 'middle' && button !== 'right')) {
          return error(request.id, 'INVALID_ARGUMENTS', 'click requires tabId, target, and an optional mouse button.')
        }

        return {
          id: request.id,
          result: await pageResult(dependencies, request.arguments.tabId, {
            button,
            target: request.arguments.target,
            type: 'hermes.bridge.click',
            version: 1
          }),
          type: 'response'
        }
      }

      if (request.method === 'type') {
        const validKeys = exactKeys(request.arguments, ['tabId', 'target', 'text']) ||
          exactKeys(request.arguments, ['submit', 'tabId', 'target', 'text'])

        const submit = request.arguments.submit ?? false

        if (!validKeys || !isPositiveInteger(request.arguments.tabId) || !validTarget(request.arguments.target) ||
          typeof request.arguments.text !== 'string' || request.arguments.text.length > 100_000 ||
          typeof submit !== 'boolean') {
          return error(request.id, 'INVALID_ARGUMENTS', 'type requires tabId, target, text, and an optional submit flag.')
        }

        return {
          id: request.id,
          result: await pageResult(dependencies, request.arguments.tabId, {
            submit,
            target: request.arguments.target,
            text: request.arguments.text,
            type: 'hermes.bridge.type',
            version: 1
          }),
          type: 'response'
        }
      }

      if (request.method === 'key') {
        const validKeys = exactKeys(request.arguments, ['key', 'tabId']) ||
          exactKeys(request.arguments, ['key', 'modifiers', 'tabId'])

        const modifiers = request.arguments.modifiers ?? []

        if (!validKeys || !isPositiveInteger(request.arguments.tabId) || typeof request.arguments.key !== 'string' ||
          request.arguments.key.length === 0 || request.arguments.key.length > 64 || !validModifiers(modifiers)) {
          return error(request.id, 'INVALID_ARGUMENTS', 'key requires tabId, key, and optional unique modifiers.')
        }

        return {
          id: request.id,
          result: await pageResult(dependencies, request.arguments.tabId, {
            key: request.arguments.key,
            modifiers,
            type: 'hermes.bridge.key',
            version: 1
          }),
          type: 'response'
        }
      }

      if (request.method === 'scroll') {
        const validKeys = Object.keys(request.arguments).every(key =>
          key === 'deltaX' || key === 'deltaY' || key === 'tabId' || key === 'target'
        )

        const deltaX = request.arguments.deltaX ?? 0
        const deltaY = request.arguments.deltaY ?? 0

        if (!validKeys || !isPositiveInteger(request.arguments.tabId) || !validDistance(deltaX) ||
          !validDistance(deltaY) || (deltaX === 0 && deltaY === 0) ||
          (request.arguments.target !== undefined && !validTarget(request.arguments.target))) {
          return error(request.id, 'INVALID_ARGUMENTS', 'scroll requires tabId, a bounded delta, and optional target.')
        }

        return {
          id: request.id,
          result: await pageResult(dependencies, request.arguments.tabId, {
            deltaX,
            deltaY,
            ...(request.arguments.target === undefined ? {} : { target: request.arguments.target }),
            type: 'hermes.bridge.scroll',
            version: 1
          }),
          type: 'response'
        }
      }

      if (request.method === 'hover') {
        if (!exactKeys(request.arguments, ['tabId', 'target']) || !isPositiveInteger(request.arguments.tabId) ||
          !validTarget(request.arguments.target)) {
          return error(request.id, 'INVALID_ARGUMENTS', 'hover requires a positive tabId and target.')
        }

        return {
          id: request.id,
          result: await pageResult(dependencies, request.arguments.tabId, {
            target: request.arguments.target,
            type: 'hermes.bridge.hover',
            version: 1
          }),
          type: 'response'
        }
      }

      if (request.method === 'eval') {
        const validKeys = exactKeys(request.arguments, ['approvalIntent', 'source', 'tabId']) ||
          exactKeys(request.arguments, ['approvalIntent', 'source', 'tabId', 'timeoutMs'])

        const timeoutMs = request.arguments.timeoutMs ?? 2_000

        if (!validKeys || request.arguments.approvalIntent !== 'explicit-user-approved-js-eval' ||
          !isPositiveInteger(request.arguments.tabId) ||
          typeof request.arguments.source !== 'string' || request.arguments.source.length === 0 ||
          request.arguments.source.length > 100_000 || !Number.isInteger(timeoutMs) ||
          (timeoutMs as number) < 100 || (timeoutMs as number) > 10_000) {
          return error(
            request.id,
            'INVALID_ARGUMENTS',
            'eval requires tabId, bounded source, explicit eval approval intent, and optional timeout.'
          )
        }

        if (dependencies.pageRuntimeService === undefined) {
          return error(request.id, 'PAGE_RUNTIME_UNAVAILABLE', 'The page runtime is unavailable.')
        }

        try {
          return {
            id: request.id,
            result: await dependencies.pageRuntimeService.eval(request.arguments.tabId, {
              source: request.arguments.source,
              timeoutMs: timeoutMs as number
            }),
            type: 'response'
          }
        } catch (error_) {
          return runtimeError(request.id, error_)
        }
      }

      if (request.method === 'console') {
        const validKeys = Object.keys(request.arguments).every(key =>
          key === 'levels' || key === 'limit' || key === 'tabId'
        )

        const levels = request.arguments.levels ?? ['debug', 'error', 'info', 'log', 'warn']
        const limit = request.arguments.limit ?? 50

        if (!validKeys || !isPositiveInteger(request.arguments.tabId) || !validConsoleLevels(levels) ||
          !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 200) {
          return error(request.id, 'INVALID_ARGUMENTS', 'console requires tabId and optional bounded levels and limit.')
        }

        if (dependencies.pageRuntimeService === undefined) {
          return error(request.id, 'PAGE_RUNTIME_UNAVAILABLE', 'The page runtime is unavailable.')
        }

        try {
          return {
            id: request.id,
            result: await dependencies.pageRuntimeService.console(request.arguments.tabId, {
              levels,
              limit: limit as number
            }),
            type: 'response'
          }
        } catch (error_) {
          return runtimeError(request.id, error_)
        }
      }

      if (request.method === 'screenshot') {
        const validKeys = Object.keys(request.arguments).every(key =>
          key === 'format' || key === 'quality' || key === 'tabId'
        )

        const format = request.arguments.format ?? 'png'

        if (!validKeys || !isPositiveInteger(request.arguments.tabId) || (format !== 'jpeg' && format !== 'png') ||
          (request.arguments.quality !== undefined &&
            (!Number.isInteger(request.arguments.quality) || (request.arguments.quality as number) < 1 ||
              (request.arguments.quality as number) > 100 || format !== 'jpeg'))) {
          return error(request.id, 'INVALID_ARGUMENTS', 'screenshot requires tabId and valid format and quality.')
        }

        await dependencies.tabService.assertControllable(request.arguments.tabId)

        return {
          id: request.id,
          result: await dependencies.screenshotService.capture({
            format,
            ...(request.arguments.quality === undefined ? {} : { quality: request.arguments.quality as number }),
            tabId: request.arguments.tabId
          }),
          type: 'response'
        }
      }

      return error(request.id, 'METHOD_NOT_IMPLEMENTED', 'This bridge method is not implemented.')
    } catch (caught) {
      if (caught instanceof TabServiceError) {
        return error(request.id, caught.code, caught.message)
      }

      if (caught instanceof PageRequestError) {
        return error(request.id, caught.code, caught.message)
      }

      if (caught instanceof TabActionError) {
        return error(request.id, caught.code, caught.message)
      }

      if (caught instanceof ScreenshotError) {
        return error(request.id, caught.code, caught.message)
      }

      return error(request.id, 'BRIDGE_ERROR', 'The Chrome bridge request failed.')
    }
  }
}
