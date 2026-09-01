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

const STATE_CHANGE_ANNOTATIONS = {
  destructiveHint: false,
  openWorldHint: false,
  readOnlyHint: false
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
    annotations: STATE_CHANGE_ANNOTATIONS,
    description: 'Select an existing controllable tab without focusing or activating it.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        tabId: { minimum: 1, type: 'integer' }
      },
      required: ['tabId'],
      type: 'object'
    },
    name: 'chrome_bridge_select_tab'
  },
  {
    annotations: READ_ONLY_ANNOTATIONS,
    description: 'Capture a bounded, redacted accessibility or DOM snapshot from a controllable Chrome tab.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        format: { default: 'both', enum: ['accessibility', 'dom', 'both'], type: 'string' },
        tabId: { minimum: 1, type: 'integer' }
      },
      type: 'object'
    },
    name: 'chrome_bridge_snapshot'
  },
  {
    annotations: READ_ONLY_ANNOTATIONS,
    description: 'Query bounded, redacted page metadata with a CSS selector in a controllable Chrome tab.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        limit: { default: 20, maximum: 100, minimum: 1, type: 'integer' },
        selector: { maxLength: 2048, minLength: 1, type: 'string' },
        tabId: { minimum: 1, type: 'integer' }
      },
      required: ['tabId', 'selector'],
      type: 'object'
    },
    name: 'chrome_bridge_query'
  }
] as const satisfies readonly Tool[]
