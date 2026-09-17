import { describe, expect, it } from 'vitest'

import { toolOutput } from './tool-output.js'

describe('token-efficient MCP results', () => {
  it('delivers screenshot bytes as image content, never as model text', () => {
    const result = toolOutput('screenshot', {
      bytes: 3, format: 'png', dataUrl: 'data:image/png;base64,YWJj', connectionId: 'profile'
    })

    expect(result).toEqual([
      { type: 'text', text: '{"bytes":3,"format":"png","connectionId":"profile"}' },
      { type: 'image', mimeType: 'image/png', data: 'YWJj' }
    ])
  })

  it('omits repeated tab metadata while retaining routing handles and meaningful flags', () => {
    const tab = { tabId: 'opaque:tab', title: 'Development', url: 'http://localhost:5173/',
      titleTruncated: false, titleRedacted: false, urlTruncated: true, urlRedacted: false,
      active: false, selected: true, windowId: 72, connectionId: 'profile' }

    const raw = { tabs: [tab], count: 1, truncated: false, connectionId: 'profile' }
    const compact = JSON.parse((toolOutput('tabs', raw)[0] as { text: string }).text)
    expect(compact.tabs).toEqual([{ tabId: tab.tabId, title: tab.title, url: tab.url,
      urlTruncated: true, selected: true }])
    expect(compact.connectionId).toBe('profile')
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(raw).length)
    expect(JSON.parse((toolOutput('tabs', raw, 'full')[0] as { text: string }).text)).toEqual(raw)
  })

  it('preserves non-image results without changing success/error semantics', () => {
    expect(toolOutput('click', { clicked: true, tabId: 'tab' })).toEqual([
      { type: 'text', text: '{"clicked":true,"tabId":"tab"}' }
    ])
  })
})
