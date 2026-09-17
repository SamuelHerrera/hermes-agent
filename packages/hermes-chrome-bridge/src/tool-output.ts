import type { ImageContent, TextContent } from '@modelcontextprotocol/sdk/types.js'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Keep binary images out of text tokenization; preserve explicit full diagnostics. */
export function toolOutput(method: string, result: unknown, detail: 'compact' | 'full' = 'compact'):
  Array<ImageContent | TextContent> {
  if (record(result) && typeof result.dataUrl === 'string' && method === 'screenshot') {
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/u.exec(result.dataUrl)

    if (match !== null) {
      const { dataUrl: _dataUrl, ...metadata } = result

      return [
        { type: 'text', text: JSON.stringify(metadata) },
        { type: 'image', mimeType: `image/${match[1]}`, data: match[2] as string }
      ]
    }
  }

  if (detail === 'compact' && method === 'tabs' && record(result) && Array.isArray(result.tabs)) {
    result = {
      ...result,
      tabs: result.tabs.map(tab => {
        if (!record(tab)) { return tab }

        return Object.fromEntries(Object.entries(tab).filter(([key, value]) =>
          key !== 'connectionId' && key !== 'windowId' && value !== false
        ))
      })
    }
  }

  return [{ type: 'text', text: JSON.stringify(result) ?? 'null' }]
}
