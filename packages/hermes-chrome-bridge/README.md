# Hermes Chrome Bridge MCP Server

A standalone, local [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes the Hermes Chrome bridge tool surface over stdio.

This package is currently a transport skeleton. It advertises the MCP tools and routes calls through an injectable `ChromeBridgeRequestRouter`; a native Chrome bridge connection will be added separately. Until then, direct tool calls report that the bridge is disconnected.

## Tools

- `chrome_bridge_status` — report local bridge connection status.
- `chrome_bridge_tabs` — list tabs exposed by the bridge.
- `chrome_bridge_snapshot` — capture an accessibility snapshot from the active tab.

## Development

From the repository root:

```sh
npm install
npm run check --workspace @hermes/chrome-bridge
npm start --workspace @hermes/chrome-bridge
```

`npm install` prepares the executable, and `check` rebuilds it before running
the stdio integration test against `dist/server.js`.

The server uses stdio for MCP messages. Keep stdout reserved for the protocol; diagnostics, if added later, must go to stderr.

## MCP host configuration

After building, configure an MCP host to launch:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/Hermes-Agent/packages/hermes-chrome-bridge/dist/server.js"]
}
```
