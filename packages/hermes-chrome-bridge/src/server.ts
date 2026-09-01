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
  method: 'query' | 'selectTab' | 'snapshot' | 'status' | 'tabs'
}

export interface ChromeBridgeRequestRouter {
  route(request: ChromeBridgeRequest): Promise<unknown>
}

const TOOL_METHODS: Record<string, ChromeBridgeRequest['method']> = {
  chrome_bridge_query: 'query',
  chrome_bridge_select_tab: 'selectTab',
  chrome_bridge_snapshot: 'snapshot',
  chrome_bridge_status: 'status',
  chrome_bridge_tabs: 'tabs'
}

function validPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) > 0
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
  router: ChromeBridgeRequestRouter = disconnectedRouter
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
  const server = createChromeBridgeServer(handle.router)
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
