import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createChromeBridgeServer } from './server.js'
import type { ChromeBridgeRequestRouter } from './server.js'

const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async client => client.close()))
})

describe('Hermes Chrome bridge MCP server', () => {
  it('routes tool calls through an injectable bridge request router', async () => {
    const route = vi.fn<ChromeBridgeRequestRouter['route']>().mockResolvedValue({
      connected: false,
      reason: 'native bridge is not configured'
    })

    const server = createChromeBridgeServer({ route })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })
    clients.push(client)

    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const result = await client.callTool({ name: 'chrome_bridge_status' })

    expect(route).toHaveBeenCalledWith({
      arguments: {},
      method: 'status'
    })
    expect(result.content).toEqual([
      {
        text: JSON.stringify({
          connected: false,
          reason: 'native bridge is not configured'
        }),
        type: 'text'
      }
    ])
  })

  it('marks every advertised tool as read-only and non-destructive', async () => {
    const server = createChromeBridgeServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })
    clients.push(client)

    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const { tools } = await client.listTools()

    expect(tools).not.toHaveLength(0)

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true)
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false)
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false)
    }
  })

  it('rejects arguments that violate the advertised empty schemas', async () => {
    const route = vi.fn<ChromeBridgeRequestRouter['route']>().mockResolvedValue({
      connected: false
    })

    const server = createChromeBridgeServer({ route })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })
    clients.push(client)

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const result = await client.callTool({
      arguments: { unexpected: true },
      name: 'chrome_bridge_status'
    })

    expect(route).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        text: 'Invalid arguments for chrome_bridge_status: expected an empty object',
        type: 'text'
      }
    ])
  })

  it('returns a tool error for unknown tool names', async () => {
    const server = createChromeBridgeServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })
    clients.push(client)

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const result = await client.callTool({ name: 'not_a_bridge_tool' })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        text: 'Unknown tool: not_a_bridge_tool',
        type: 'text'
      }
    ])
  })

  it('initializes over stdio and advertises the bridge tools', async () => {
    const transport = new StdioClientTransport({
      args: ['dist/server.js'],
      command: process.execPath,
      cwd: process.cwd(),
      stderr: 'pipe'
    })

    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })
    clients.push(client)

    await client.connect(transport)
    const { tools } = await client.listTools()

    expect(tools.map(tool => tool.name)).toEqual([
      'chrome_bridge_status',
      'chrome_bridge_tabs',
      'chrome_bridge_snapshot'
    ])
  })
})