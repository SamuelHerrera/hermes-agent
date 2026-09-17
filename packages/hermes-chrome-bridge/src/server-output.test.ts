import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createChromeBridgeServer } from './server.js'

const clients: Client[] = []
afterEach(async () => Promise.all(clients.splice(0).map(client => client.close())))

async function connect(result: unknown) {
  const route = vi.fn(async () => result)
  const server = createChromeBridgeServer({ route })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'compact-output-contract', version: '1' })
  clients.push(client)
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return { client, route }
}

describe('MCP response projection integration', () => {
  it('returns actual image blocks through MCP instead of tokenizing base64', async () => {
    const { client } = await connect({ bytes: 3, format: 'png', dataUrl: 'data:image/png;base64,YWJj' })
    const response = await client.callTool({ name: 'chrome_bridge_screenshot', arguments: { tabId: 7 } })
    expect(response.content).toEqual([
      { type: 'text', text: '{"bytes":3,"format":"png"}' },
      { type: 'image', data: 'YWJj', mimeType: 'image/png' }
    ])
  })

  it('validates full diagnostics as host-only projection and never forwards it to Chrome', async () => {
    const data = { tabs: [{ tabId: 7, title: 'dev', windowId: 9, active: false }] }
    const { client, route } = await connect(data)
    const response = await client.callTool({ name: 'chrome_bridge_tabs', arguments: { detail: 'full' } })
    expect(response.isError).not.toBe(true)
    expect(response.content).toEqual([{ type: 'text', text: JSON.stringify(data) }])
    expect(route).toHaveBeenCalledWith({ method: 'tabs', arguments: {} }, expect.any(AbortSignal))
    const rejected = await client.callTool({ name: 'chrome_bridge_tabs', arguments: { detail: 'invalid' } })
    expect(rejected.isError).toBe(true)
    expect(route).toHaveBeenCalledTimes(1)
  })
})
