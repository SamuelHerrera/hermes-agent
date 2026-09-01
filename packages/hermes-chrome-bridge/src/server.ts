#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

import { CHROME_BRIDGE_TOOLS } from './schema.js'

export interface ChromeBridgeRequest {
  arguments: Record<string, unknown>
  method: 'snapshot' | 'status' | 'tabs'
}

export interface ChromeBridgeRequestRouter {
  route(request: ChromeBridgeRequest): Promise<unknown>
}

const TOOL_METHODS: Record<string, ChromeBridgeRequest['method']> = {
  chrome_bridge_snapshot: 'snapshot',
  chrome_bridge_status: 'status',
  chrome_bridge_tabs: 'tabs'
}

const disconnectedRouter: ChromeBridgeRequestRouter = {
  route: async request => ({
    connected: false,
    method: request.method,
    reason: 'native Chrome bridge is not connected'
  })
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

    if (Object.keys(toolArguments).length > 0) {
      return {
        content: [{
          text: `Invalid arguments for ${request.params.name}: expected an empty object`,
          type: 'text'
        }],
        isError: true
      }
    }

    const result = await router.route({
      arguments: toolArguments,
      method
    })

    return {
      content: [{ text: JSON.stringify(result), type: 'text' }]
    }
  })

  return server
}

export async function runStdioServer(): Promise<void> {
  const server = createChromeBridgeServer()
  const transport = new StdioServerTransport()

  await server.connect(transport)
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
  await runStdioServer()
}
