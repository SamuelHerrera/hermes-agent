import type { Tool } from '@modelcontextprotocol/sdk/types.js'

const EMPTY_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {},
  type: 'object'
} as const

export const CHROME_BRIDGE_TOOLS = [
  {
    description: 'Report whether the local Hermes Chrome bridge is connected.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    name: 'chrome_bridge_status'
  },
  {
    description: 'List tabs exposed by the local Hermes Chrome bridge.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    name: 'chrome_bridge_tabs'
  },
  {
    description: 'Capture an accessibility snapshot from the active Chrome tab.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    name: 'chrome_bridge_snapshot'
  }
] as const satisfies readonly Tool[]
