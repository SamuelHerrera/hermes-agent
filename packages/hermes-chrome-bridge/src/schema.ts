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

const OPEN_WORLD_CHANGE_ANNOTATIONS = {
  destructiveHint: false,
  openWorldHint: true,
  readOnlyHint: false
} as const

const DESTRUCTIVE_ANNOTATIONS = {
  destructiveHint: true,
  openWorldHint: false,
  readOnlyHint: false
} as const

const DESTRUCTIVE_OPEN_WORLD_ANNOTATIONS = {
  destructiveHint: true,
  openWorldHint: true,
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
  },
  {
    annotations: OPEN_WORLD_CHANGE_ANNOTATIONS,
    description: 'Open a public HTTP(S) URL in a new Chrome tab.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        active: { default: true, type: 'boolean' },
        url: { maxLength: 8192, type: 'string' }
      },
      type: 'object'
    },
    name: 'chrome_bridge_open'
  },
  {
    annotations: OPEN_WORLD_CHANGE_ANNOTATIONS,
    description: 'Navigate a controllable Chrome tab to a public HTTP(S) URL.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        tabId: { minimum: 1, type: 'integer' },
        url: { maxLength: 8192, minLength: 1, type: 'string' }
      },
      required: ['tabId', 'url'],
      type: 'object'
    },
    name: 'chrome_bridge_navigate'
  },
  {
    annotations: STATE_CHANGE_ANNOTATIONS,
    description: 'Focus a controllable Chrome tab and its window.',
    inputSchema: {
      additionalProperties: false,
      properties: { tabId: { minimum: 1, type: 'integer' } },
      required: ['tabId'],
      type: 'object'
    },
    name: 'chrome_bridge_focus'
  },
  {
    annotations: DESTRUCTIVE_ANNOTATIONS,
    description: 'Close a controllable Chrome tab.',
    inputSchema: {
      additionalProperties: false,
      properties: { tabId: { minimum: 1, type: 'integer' } },
      required: ['tabId'],
      type: 'object'
    },
    name: 'chrome_bridge_close'
  },
  {
    annotations: DESTRUCTIVE_OPEN_WORLD_ANNOTATIONS,
    description: 'Click a referenced element or CSS selector in a controllable Chrome tab.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        button: { default: 'left', enum: ['left', 'middle', 'right'], type: 'string' },
        tabId: { minimum: 1, type: 'integer' },
        target: { maxLength: 2048, minLength: 1, type: 'string' }
      },
      required: ['tabId', 'target'],
      type: 'object'
    },
    name: 'chrome_bridge_click'
  },
  {
    annotations: DESTRUCTIVE_OPEN_WORLD_ANNOTATIONS,
    description: 'Type explicit text into a non-sensitive referenced element or CSS selector.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        submit: { default: false, type: 'boolean' },
        tabId: { minimum: 1, type: 'integer' },
        target: { maxLength: 2048, minLength: 1, type: 'string' },
        text: { maxLength: 100000, type: 'string' }
      },
      required: ['tabId', 'target', 'text'],
      type: 'object'
    },
    name: 'chrome_bridge_type'
  },
  {
    annotations: DESTRUCTIVE_OPEN_WORLD_ANNOTATIONS,
    description: 'Press a key in a controllable Chrome tab.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        key: { maxLength: 64, minLength: 1, type: 'string' },
        modifiers: {
          items: { enum: ['alt', 'ctrl', 'meta', 'shift'], type: 'string' },
          maxItems: 4,
          type: 'array',
          uniqueItems: true
        },
        tabId: { minimum: 1, type: 'integer' }
      },
      required: ['tabId', 'key'],
      type: 'object'
    },
    name: 'chrome_bridge_key'
  },
  {
    annotations: STATE_CHANGE_ANNOTATIONS,
    description: 'Scroll a controllable Chrome tab or referenced element by bounded deltas.',
    inputSchema: {
      additionalProperties: false,
      anyOf: [{ required: ['deltaX'] }, { required: ['deltaY'] }],
      properties: {
        deltaX: { maximum: 100000, minimum: -100000, type: 'number' },
        deltaY: { maximum: 100000, minimum: -100000, type: 'number' },
        tabId: { minimum: 1, type: 'integer' },
        target: { maxLength: 2048, minLength: 1, type: 'string' }
      },
      required: ['tabId'],
      type: 'object'
    },
    name: 'chrome_bridge_scroll'
  },
  {
    annotations: STATE_CHANGE_ANNOTATIONS,
    description: 'Hover a referenced element or CSS selector in a controllable Chrome tab.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        tabId: { minimum: 1, type: 'integer' },
        target: { maxLength: 2048, minLength: 1, type: 'string' }
      },
      required: ['tabId', 'target'],
      type: 'object'
    },
    name: 'chrome_bridge_hover'
  },
  {
    annotations: DESTRUCTIVE_OPEN_WORLD_ANNOTATIONS,
    description: 'Execute explicit JavaScript on a public, non-sensitive Chrome page with bounded structured output.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        source: { maxLength: 100000, minLength: 1, type: 'string' },
        tabId: { minimum: 1, type: 'integer' },
        timeoutMs: { default: 2000, maximum: 10000, minimum: 100, type: 'integer' }
      },
      required: ['tabId', 'source'],
      type: 'object'
    },
    name: 'chrome_bridge_eval'
  },
  {
    annotations: READ_ONLY_ANNOTATIONS,
    description: 'Read a bounded, redacted ring of console entries captured from a controllable Chrome tab.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        levels: {
          items: { enum: ['debug', 'error', 'info', 'log', 'warn'], type: 'string' },
          maxItems: 5,
          type: 'array',
          uniqueItems: true
        },
        limit: { default: 50, maximum: 200, minimum: 1, type: 'integer' },
        tabId: { minimum: 1, type: 'integer' }
      },
      required: ['tabId'],
      type: 'object'
    },
    name: 'chrome_bridge_console'
  },
  {
    annotations: READ_ONLY_ANNOTATIONS,
    description: 'Capture a bounded screenshot from a controllable Chrome tab with the Hermes indicator visible.',
    inputSchema: {
      additionalProperties: false,
      allOf: [{
        if: { required: ['quality'] },
        then: { properties: { format: { const: 'jpeg' } }, required: ['format'] }
      }],
      properties: {
        format: { default: 'png', enum: ['jpeg', 'png'], type: 'string' },
        quality: { maximum: 100, minimum: 1, type: 'integer' },
        tabId: { minimum: 1, type: 'integer' }
      },
      required: ['tabId'],
      type: 'object'
    },
    name: 'chrome_bridge_screenshot'
  }
] as const satisfies readonly Tool[]
