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

  it('marks reads, state changes, and potentially destructive interactions accurately', async () => {
    const server = createChromeBridgeServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })
    clients.push(client)

    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const { tools } = await client.listTools()

    const readOnly = new Set([
      'chrome_bridge_status', 'chrome_bridge_tabs', 'chrome_bridge_snapshot', 'chrome_bridge_query',
      'chrome_bridge_console', 'chrome_bridge_screenshot'
    ])

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(readOnly.has(tool.name))
    }

    expect(tools.find(tool => tool.name === 'chrome_bridge_select_tab')?.annotations).toMatchObject({
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false
    })
    expect(tools.find(tool => tool.name === 'chrome_bridge_close')?.annotations?.destructiveHint).toBe(true)
    expect(tools.find(tool => tool.name === 'chrome_bridge_click')?.annotations).toMatchObject({
      destructiveHint: true,
      openWorldHint: true,
      readOnlyHint: false
    })
    expect(tools.find(tool => tool.name === 'chrome_bridge_eval')?.annotations).toMatchObject({
      destructiveHint: true,
      openWorldHint: true,
      readOnlyHint: false
    })
  })

  it('strictly validates and routes one positive integer tab selection', async () => {
    const route = vi.fn<ChromeBridgeRequestRouter['route']>().mockResolvedValue({ selectedTabId: 17 })
    const server = createChromeBridgeServer({ route })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })
    clients.push(client)
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const selected = await client.callTool({
      arguments: { tabId: 17 },
      name: 'chrome_bridge_select_tab'
    })

    expect(route).toHaveBeenCalledWith({ arguments: { tabId: 17 }, method: 'selectTab' })
    expect(JSON.parse((selected.content as Array<{ text: string }>)[0]?.text ?? 'null')).toEqual({
      selectedTabId: 17
    })

    for (const arguments_ of [{}, { tabId: 0 }, { tabId: 1.5 }, { tabId: '17' }, { extra: true, tabId: 17 }]) {
      const invalid = await client.callTool({ arguments: arguments_, name: 'chrome_bridge_select_tab' })
      expect(invalid.isError).toBe(true)
    }

    expect(route).toHaveBeenCalledTimes(1)
  })

  it('validates and routes bounded snapshot and query arguments', async () => {
    const route = vi.fn<ChromeBridgeRequestRouter['route']>().mockResolvedValue({ count: 0 })
    const server = createChromeBridgeServer({ route })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })

    clients.push(client)
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const snapshot = await client.callTool({
      arguments: { format: 'both', tabId: 7 },
      name: 'chrome_bridge_snapshot'
    })

    const query = await client.callTool({
      arguments: { limit: 20, selector: 'button.primary', tabId: 7 },
      name: 'chrome_bridge_query'
    })

    expect(snapshot.isError).not.toBe(true)
    expect(query.isError).not.toBe(true)
    expect(route).toHaveBeenNthCalledWith(1, {
      arguments: { format: 'both', tabId: 7 }, method: 'snapshot'
    })
    expect(route).toHaveBeenNthCalledWith(2, {
      arguments: { limit: 20, selector: 'button.primary', tabId: 7 }, method: 'query'
    })

    for (const call of [
      { arguments: { format: 'invalid' }, name: 'chrome_bridge_snapshot' },
      { arguments: { selector: '', tabId: 7 }, name: 'chrome_bridge_query' },
      { arguments: { limit: 101, selector: 'button', tabId: 7 }, name: 'chrome_bridge_query' },
      { arguments: { selector: 'button', tabId: 0 }, name: 'chrome_bridge_query' }
    ]) {
      await expect(client.callTool(call)).resolves.toMatchObject({ isError: true })
    }

    expect(route).toHaveBeenCalledTimes(2)
  })

  it('validates and routes navigation and user-like interaction tools', async () => {
    const route = vi.fn<ChromeBridgeRequestRouter['route']>().mockResolvedValue({ ok: true })
    const server = createChromeBridgeServer({ route })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })

    clients.push(client)
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const validCalls = [
      { arguments: { active: false, url: 'https://example.test/' }, name: 'chrome_bridge_open' },
      { arguments: { tabId: 7, url: 'https://example.test/next' }, name: 'chrome_bridge_navigate' },
      { arguments: { tabId: 7 }, name: 'chrome_bridge_focus' },
      { arguments: { tabId: 7 }, name: 'chrome_bridge_close' },
      { arguments: { button: 'left', tabId: 7, target: 'e1' }, name: 'chrome_bridge_click' },
      { arguments: { submit: false, tabId: 7, target: 'e2', text: 'explicit' }, name: 'chrome_bridge_type' },
      { arguments: { key: 'Enter', modifiers: ['ctrl'], tabId: 7 }, name: 'chrome_bridge_key' },
      { arguments: { deltaY: 50, tabId: 7 }, name: 'chrome_bridge_scroll' },
      { arguments: { tabId: 7, target: 'e3' }, name: 'chrome_bridge_hover' }
    ]

    for (const call of validCalls) {
      await expect(client.callTool(call)).resolves.not.toMatchObject({ isError: true })
    }

    expect(route).toHaveBeenCalledTimes(validCalls.length)

    const invalidCalls = [
      { arguments: { active: 'yes' }, name: 'chrome_bridge_open' },
      { arguments: { tabId: 0, url: 'https://example.test/' }, name: 'chrome_bridge_navigate' },
      { arguments: { button: 'other', tabId: 7, target: 'e1' }, name: 'chrome_bridge_click' },
      { arguments: { submit: false, tabId: 7, target: 'e1' }, name: 'chrome_bridge_type' },
      { arguments: { key: '', tabId: 7 }, name: 'chrome_bridge_key' },
      { arguments: { deltaY: 100_001, tabId: 7 }, name: 'chrome_bridge_scroll' },
      { arguments: { tabId: 7, target: '' }, name: 'chrome_bridge_hover' }
    ]

    for (const call of invalidCalls) {
      await expect(client.callTool(call)).resolves.toMatchObject({ isError: true })
    }

    expect(route).toHaveBeenCalledTimes(validCalls.length)
  })

  it('validates guarded eval, console, and screenshot tools', async () => {
    const route = vi.fn<ChromeBridgeRequestRouter['route']>().mockResolvedValue({ ok: true })
    const server = createChromeBridgeServer({ route }, { allowEval: true })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'chrome-bridge-test', version: '0.1.0' })

    clients.push(client)
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const validCalls = [
      {
        arguments: {
          approvalIntent: 'explicit-user-approved-js-eval',
          source: 'document.title',
          tabId: 7,
          timeoutMs: 500
        },
        name: 'chrome_bridge_eval'
      },
      { arguments: { levels: ['error'], limit: 10, tabId: 7 }, name: 'chrome_bridge_console' },
      { arguments: { format: 'jpeg', quality: 80, tabId: 7 }, name: 'chrome_bridge_screenshot' }
    ]

    for (const call of validCalls) {
      await expect(client.callTool(call)).resolves.not.toMatchObject({ isError: true })
    }

    expect(route).toHaveBeenCalledTimes(validCalls.length)

    const invalidCalls = [
      { arguments: { source: '', tabId: 7 }, name: 'chrome_bridge_eval' },
      { arguments: { levels: ['private'], tabId: 7 }, name: 'chrome_bridge_console' },
      { arguments: { format: 'png', quality: 80, tabId: 7 }, name: 'chrome_bridge_screenshot' }
    ]

    for (const call of invalidCalls) {
      await expect(client.callTool(call)).resolves.toMatchObject({ isError: true })
    }

    expect(route).toHaveBeenCalledTimes(validCalls.length)
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
    const statusCall = client.callTool({ name: 'chrome_bridge_status' })

    while (messages.length === 0) { await new Promise(resolveWait => setTimeout(resolveWait, 5)) }
    const statusRequest = messages.shift() as Record<string, unknown>
    expect(statusRequest).toMatchObject({ arguments: {}, method: 'status', type: 'request' })
    socket.write(`${JSON.stringify({
      id: statusRequest.id,
      result: { bridgeConnected: true, nativeConnected: true, selectedTabId: 11 },
      type: 'response'
    })}\n`)
    const status = await statusCall
    const statusContent = status.content as Array<{ text: string }>
    expect(JSON.parse(statusContent[0]?.text ?? 'null')).toEqual({
      bridgeConnected: true,
      nativeConnected: true,
      selectedTabId: 11
    })

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
      'chrome_bridge_select_tab',
      'chrome_bridge_snapshot',
      'chrome_bridge_query',
      'chrome_bridge_open',
      'chrome_bridge_navigate',
      'chrome_bridge_focus',
      'chrome_bridge_close',
      'chrome_bridge_click',
      'chrome_bridge_type',
      'chrome_bridge_key',
      'chrome_bridge_scroll',
      'chrome_bridge_hover',
      'chrome_bridge_eval',
      'chrome_bridge_console',
      'chrome_bridge_screenshot'
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
      'chrome_bridge_select_tab',
      'chrome_bridge_snapshot',
      'chrome_bridge_query',
      'chrome_bridge_open',
      'chrome_bridge_navigate',
      'chrome_bridge_focus',
      'chrome_bridge_close',
      'chrome_bridge_click',
      'chrome_bridge_type',
      'chrome_bridge_key',
      'chrome_bridge_scroll',
      'chrome_bridge_hover',
      'chrome_bridge_eval',
      'chrome_bridge_console',
      'chrome_bridge_screenshot'
    ])
  })
})