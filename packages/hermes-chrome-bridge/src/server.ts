#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

import { BridgeBrokerError, ChromeBridgeBroker } from './broker.js'
import {
  readRuntimeConfig,
  resolveHermesHome,
  runtimeDirectoryFor
} from './runtime.js'
import { CHROME_BRIDGE_TOOLS } from './schema.js'

export interface ChromeBridgeRequest {
  arguments: Record<string, unknown>
  method: 'click' | 'close' | 'console' | 'eval' | 'focus' | 'hover' | 'key' | 'navigate' |
    'open' | 'query' | 'screenshot' | 'scroll' | 'selectTab' | 'snapshot' | 'status' | 'tabs' |
    'type'
}

export interface ChromeBridgeRequestRouter {
  route(request: ChromeBridgeRequest): Promise<unknown>
}

export interface ChromeBridgeServerOptions {
  allowEval?: boolean
}

const TOOL_METHODS: Record<string, ChromeBridgeRequest['method']> = {
  chrome_bridge_click: 'click',
  chrome_bridge_close: 'close',
  chrome_bridge_console: 'console',
  chrome_bridge_eval: 'eval',
  chrome_bridge_focus: 'focus',
  chrome_bridge_hover: 'hover',
  chrome_bridge_key: 'key',
  chrome_bridge_navigate: 'navigate',
  chrome_bridge_open: 'open',
  chrome_bridge_query: 'query',
  chrome_bridge_screenshot: 'screenshot',
  chrome_bridge_scroll: 'scroll',
  chrome_bridge_select_tab: 'selectTab',
  chrome_bridge_snapshot: 'snapshot',
  chrome_bridge_status: 'status',
  chrome_bridge_tabs: 'tabs',
  chrome_bridge_type: 'type'
}

function validPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) > 0
}

function validTarget(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_048
}

function validModifiers(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 4) { return false }
  const allowed = new Set(['alt', 'ctrl', 'meta', 'shift'])

  return value.every(modifier => typeof modifier === 'string' && allowed.has(modifier)) &&
    new Set(value).size === value.length
}

function validConsoleLevels(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 5) { return false }
  const allowed = new Set(['debug', 'error', 'info', 'log', 'warn'])

  return value.every(level => typeof level === 'string' && allowed.has(level)) &&
    new Set(value).size === value.length
}

function validDistance(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000
}

function validToolArguments(method: ChromeBridgeRequest['method'], arguments_: Record<string, unknown>): boolean {
  const keys = Object.keys(arguments_)

  if (method === 'selectTab') {
    return keys.length === 1 && validPositiveInteger(arguments_.tabId)
  }

  if (method === 'snapshot') {
    const format = arguments_.format ?? 'both'

    return keys.every(key => key === 'format' || key === 'tabId') &&
      (format === 'accessibility' || format === 'dom' || format === 'both') &&
      (arguments_.tabId === undefined || validPositiveInteger(arguments_.tabId))
  }

  if (method === 'query') {
    const validLimit = arguments_.limit === undefined ||
      (Number.isInteger(arguments_.limit) && (arguments_.limit as number) > 0 && (arguments_.limit as number) <= 100)

    return keys.every(key => key === 'limit' || key === 'selector' || key === 'tabId') &&
      validPositiveInteger(arguments_.tabId) &&
      typeof arguments_.selector === 'string' && arguments_.selector.length > 0 &&
      arguments_.selector.length <= 2_048 && validLimit
  }

  if (method === 'open') {
    const active = arguments_.active ?? true

    return keys.every(key => key === 'active' || key === 'url') && typeof active === 'boolean' &&
      (arguments_.url === undefined ||
        (typeof arguments_.url === 'string' && arguments_.url.length <= 8_192))
  }

  if (method === 'navigate') {
    return keys.length === 2 && validPositiveInteger(arguments_.tabId) &&
      typeof arguments_.url === 'string' && arguments_.url.length > 0 && arguments_.url.length <= 8_192
  }

  if (method === 'focus' || method === 'close') {
    return keys.length === 1 && validPositiveInteger(arguments_.tabId)
  }

  if (method === 'click') {
    const button = arguments_.button ?? 'left'

    return keys.every(key => key === 'button' || key === 'tabId' || key === 'target') &&
      validPositiveInteger(arguments_.tabId) && validTarget(arguments_.target) &&
      (button === 'left' || button === 'middle' || button === 'right')
  }

  if (method === 'type') {
    const submit = arguments_.submit ?? false

    return keys.every(key => key === 'submit' || key === 'tabId' || key === 'target' || key === 'text') &&
      validPositiveInteger(arguments_.tabId) && validTarget(arguments_.target) &&
      typeof arguments_.text === 'string' && arguments_.text.length <= 100_000 && typeof submit === 'boolean'
  }

  if (method === 'key') {
    const modifiers = arguments_.modifiers ?? []

    return keys.every(key => key === 'key' || key === 'modifiers' || key === 'tabId') &&
      validPositiveInteger(arguments_.tabId) && typeof arguments_.key === 'string' &&
      arguments_.key.length > 0 && arguments_.key.length <= 64 && validModifiers(modifiers)
  }

  if (method === 'scroll') {
    const deltaX = arguments_.deltaX ?? 0
    const deltaY = arguments_.deltaY ?? 0

    return keys.every(key => key === 'deltaX' || key === 'deltaY' || key === 'tabId' || key === 'target') &&
      validPositiveInteger(arguments_.tabId) && validDistance(deltaX) && validDistance(deltaY) &&
      (deltaX !== 0 || deltaY !== 0) && (arguments_.target === undefined || validTarget(arguments_.target))
  }

  if (method === 'hover') {
    return keys.length === 2 && validPositiveInteger(arguments_.tabId) && validTarget(arguments_.target)
  }

  if (method === 'eval') {
    const timeoutMs = arguments_.timeoutMs ?? 2_000

    return keys.every(key => key === 'approvalIntent' || key === 'source' || key === 'tabId' || key === 'timeoutMs') &&
      arguments_.approvalIntent === 'explicit-user-approved-js-eval' &&
      validPositiveInteger(arguments_.tabId) && typeof arguments_.source === 'string' &&
      arguments_.source.length > 0 && arguments_.source.length <= 100_000 &&
      Number.isInteger(timeoutMs) && (timeoutMs as number) >= 100 && (timeoutMs as number) <= 10_000
  }

  if (method === 'console') {
    const levels = arguments_.levels ?? ['debug', 'error', 'info', 'log', 'warn']
    const limit = arguments_.limit ?? 50

    return keys.every(key => key === 'levels' || key === 'limit' || key === 'tabId') &&
      validPositiveInteger(arguments_.tabId) && validConsoleLevels(levels) && Number.isInteger(limit) &&
      (limit as number) >= 1 && (limit as number) <= 200
  }

  if (method === 'screenshot') {
    const format = arguments_.format ?? 'png'

    return keys.every(key => key === 'format' || key === 'quality' || key === 'tabId') &&
      validPositiveInteger(arguments_.tabId) && (format === 'jpeg' || format === 'png') &&
      (arguments_.quality === undefined ||
        (format === 'jpeg' && Number.isInteger(arguments_.quality) &&
          (arguments_.quality as number) >= 1 && (arguments_.quality as number) <= 100))
  }

  return keys.length === 0
}

function invalidArgumentsMessage(name: string, method: ChromeBridgeRequest['method']): string {
  if (method === 'selectTab') {
    return `Invalid arguments for ${name}: expected exactly one positive integer tabId`
  }

  if (method === 'snapshot') {
    return `Invalid arguments for ${name}: expected optional positive tabId and format accessibility, dom, or both`
  }

  if (method === 'query') {
    return `Invalid arguments for ${name}: expected positive tabId, non-empty selector, and optional limit from 1 to 100`
  }

  if (method === 'eval') {
    return `Invalid arguments for ${name}: expected positive tabId, bounded source, explicit eval approval intent, and optional timeout`
  }

  return `Invalid arguments for ${name}: expected an empty object`
}

const disconnectedRouter: ChromeBridgeRequestRouter = {
  route: async request => {
    if (request.method === 'status') {
      return {
        connected: false,
        updatedAt: new Date().toISOString(),
        version: 1
      }
    }

    throw new BridgeBrokerError(
      'BRIDGE_DISCONNECTED',
      'native Chrome bridge is disconnected'
    )
  }
}

export interface DefaultRouterHandle {
  close: () => Promise<void>
  router: ChromeBridgeRequestRouter
}

export async function createDefaultRouter(options: {
  hermesHome?: string
} = {}): Promise<DefaultRouterHandle> {
  const hermesHome = resolveHermesHome(options.hermesHome)
  const configPath = join(runtimeDirectoryFor(hermesHome), 'config.json')
  let config

  try {
    config = await readRuntimeConfig(configPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { close: async () => undefined, router: disconnectedRouter }
    }

    throw error
  }

  const broker = new ChromeBridgeBroker(config)
  await broker.start()

  return { close: async () => broker.close(), router: broker }
}

export function createChromeBridgeServer(
  router: ChromeBridgeRequestRouter = disconnectedRouter,
  options: ChromeBridgeServerOptions = {}
): Server {
  const server = new Server(
    { name: 'hermes-chrome-bridge', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...CHROME_BRIDGE_TOOLS]
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const method = TOOL_METHODS[request.params.name]

    if (method === undefined) {
      return {
        content: [{ text: `Unknown tool: ${request.params.name}`, type: 'text' }],
        isError: true
      }
    }

    const toolArguments = request.params.arguments ?? {}
    const validArguments = validToolArguments(method, toolArguments)

    if (!validArguments) {
      return {
        content: [{
          text: invalidArgumentsMessage(request.params.name, method),
          type: 'text'
        }],
        isError: true
      }
    }

    if (method === 'eval' && options.allowEval !== true) {
      return {
        content: [{
          text: 'chrome_bridge_eval requires the Chrome Bridge server to be started with explicit eval approval enabled.',
          type: 'text'
        }],
        isError: true
      }
    }

    try {
      const result = await router.route({
        arguments: toolArguments,
        method
      })

      return {
        content: [{ text: JSON.stringify(result), type: 'text' }]
      }
    } catch (error) {
      const code = error instanceof BridgeBrokerError ? error.code : 'BRIDGE_ERROR'
      const message = error instanceof Error ? error.message : 'Chrome bridge request failed'

      return {
        content: [{ text: JSON.stringify({ code, message }), type: 'text' }],
        isError: true
      }
    }
  })

  return server
}

export async function runStdioServer(options: { hermesHome?: string } = {}): Promise<void> {
  const handle = await createDefaultRouter(options)

  const server = createChromeBridgeServer(handle.router, {
    allowEval: cliAllowEval(process.argv.slice(2))
  })

  const transport = new StdioServerTransport()
  server.onclose = () => void handle.close()

  await server.connect(transport)
}

function cliHermesHome(args: string[]): string | undefined {
  const index = args.indexOf('--hermes-home')

  if (index === -1) {return undefined}
  const value = args[index + 1]

  if (value === undefined) {throw new Error('--hermes-home requires an absolute path')}

  return value
}

function cliAllowEval(args: string[]): boolean {
  return args.includes('--allow-eval')
}

function isEntrypoint(): boolean {
  if (process.argv[1] === undefined) {
    return false
  }

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (isEntrypoint()) {
  await runStdioServer({ hermesHome: cliHermesHome(process.argv.slice(2)) })
}
