import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createChromeBridgeServer, createDefaultRouter } from './server.js'
import type { ChromeBridgeRequestRouter } from './server.js'

const clients: Client[] = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async client => client.close()))
  await Promise.all(temporaryDirectories.splice(0).map(async directory => {
    await rm(directory, { force: true, recursive: true })
  }))
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

  it('starts the default broker router and serves status plus a routed MCP tool call', async () => {
    const hermesHome = await mkdtemp(join(tmpdir(), 'hcb-'))
    temporaryDirectories.push(hermesHome)
    const runtimeDirectory = join(hermesHome, 'chrome-bridge')
    await mkdir(runtimeDirectory, { recursive: true })
    const socketPath = join(runtimeDirectory, 'broker.sock')
    const token = 'c'.repeat(64)
    const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'
    await import('node:fs/promises').then(async ({ writeFile }) => writeFile(
      join(runtimeDirectory, 'config.json'),
      JSON.stringify({
        origin,
        socketPath,
        statusPath: join(runtimeDirectory, 'status.json'),
        token,
        version: 1
      }),
      { mode: 0o600 }
    ))

    const handle = await createDefaultRouter({ hermesHome })
    const socket = createConnection(socketPath)
    let buffered = ''
    const messages: Array<Record<string, unknown>> = []
    socket.on('data', chunk => {
      buffered += chunk.toString('utf8')

      for (;;) {
        const newline = buffered.indexOf('\n')

        if (newline === -1) {break}
        messages.push(JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>)
        buffered = buffered.slice(newline + 1)
      }
    })
    await new Promise<void>((resolveConnect, reject) => {
      socket.once('connect', resolveConnect)
      socket.once('error', reject)
    })
    socket.write(`${JSON.stringify({ origin, token, type: 'hello', version: 1 })}\n`)

    while (messages.length === 0) {await new Promise(resolveWait => setTimeout(resolveWait, 5))}
    expect(messages.shift()).toEqual({ type: 'hello.ok', version: 1 })

    const server = createChromeBridgeServer(handle.router)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })
    clients.push(client)
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const status = await client.callTool({ name: 'chrome_bridge_status' })
    const statusContent = status.content as Array<{ text: string }>
    expect(JSON.parse(statusContent[0]?.text ?? 'null')).toMatchObject({ connected: true })

    const tabsCall = client.callTool({ name: 'chrome_bridge_tabs' })

    while (messages.length === 0) {await new Promise(resolveWait => setTimeout(resolveWait, 5))}
    const request = messages.shift() as Record<string, unknown>
    socket.write(`${JSON.stringify({ id: request.id, result: [{ id: 11 }], type: 'response' })}\n`)
    const tabs = await tabsCall
    const tabsContent = tabs.content as Array<{ text: string }>
    expect(JSON.parse(tabsContent[0]?.text ?? 'null')).toEqual([{ id: 11 }])

    socket.destroy()
    await handle.close()
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

  it('initializes when invoked through an npm bin symlink', async () => {
    const installDirectory = await mkdtemp(join(tmpdir(), 'hermes-chrome-bridge-'))
    temporaryDirectories.push(installDirectory)

    const binDirectory = join(installDirectory, 'node_modules', '.bin')
    const binPath = join(binDirectory, 'hermes-chrome-bridge')
    await mkdir(binDirectory, { recursive: true })
    await symlink(resolve('dist/server.js'), binPath)

    const transport = new StdioClientTransport({
      args: [binPath],
      command: process.execPath,
      cwd: installDirectory,
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