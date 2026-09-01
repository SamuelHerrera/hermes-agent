#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CHROME_BRIDGE_TOOLS } from './schema.js';
const TOOL_METHODS = {
    chrome_bridge_snapshot: 'snapshot',
    chrome_bridge_status: 'status',
    chrome_bridge_tabs: 'tabs'
};
const disconnectedRouter = {
    route: async (request) => ({
        connected: false,
        method: request.method,
        reason: 'native Chrome bridge is not connected'
    })
};
export function createChromeBridgeServer(router = disconnectedRouter) {
    const server = new Server({ name: 'hermes-chrome-bridge', version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [...CHROME_BRIDGE_TOOLS]
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const method = TOOL_METHODS[request.params.name];
        if (method === undefined) {
            return {
                content: [{ text: `Unknown tool: ${request.params.name}`, type: 'text' }],
                isError: true
            };
        }
        const result = await router.route({
            arguments: request.params.arguments ?? {},
            method
        });
        return {
            content: [{ text: JSON.stringify(result), type: 'text' }]
        };
    });
    return server;
}
export async function runStdioServer() {
    const server = createChromeBridgeServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
const isEntrypoint = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
    await runStdioServer();
}
//# sourceMappingURL=server.js.map