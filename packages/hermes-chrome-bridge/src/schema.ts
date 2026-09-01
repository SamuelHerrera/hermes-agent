import type { Tool } from '@modelcontextprotocol/sdk/types.js'

const EMPTY_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {},
  type: 'object'
} as const

const READ_ONLY_ANNOTATIONS = {
  destructiveHint: false,
  openWorldHint: false,
  readOnlyHint: true
} as const

export const CHROME_BRIDGE_TOOLS = [
  {
    annotations: READ_ONLY_ANNOTATIONS,
    description: 'Report whether the local Hermes Chrome bridge is connected.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    name: 'chrome_bridge_status'
  },
  {
    annotations: READ_ONLY_ANNOTATIONS,
    description: 'List tabs exposed by the local Hermes Chrome bridge.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    name: 'chrome_bridge_tabs'
  },
  {
    annotations: READ_ONLY_ANNOTATIONS,
    description: 'Capture an accessibility snapshot from the active Chrome tab.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    name: 'chrome_bridge_snapshot'
  }
] as const satisfies readonly Tool[]
