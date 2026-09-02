import { describe, expect, it } from 'vitest'

import { isTrustedPopupCommand } from './background-policy.js'

const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
const popupUrl = `chrome-extension://${extensionId}/popup.html`

describe('background popup command policy', () => {
  it('accepts exact commands only from this extension popup', () => {
    expect(isTrustedPopupCommand(
      { type: 'bridge.connect' },
      { id: extensionId, url: popupUrl },
      extensionId,
      popupUrl
    )).toBe(true)
  })

  it.each([
    [{ type: 'bridge.connect' }, { id: extensionId, url: `chrome-extension://${extensionId}/page.html` }],
    [{ type: 'bridge.disconnect' }, { id: 'other-extension', url: popupUrl }],
    [{ type: 'bridge.status' }, { id: extensionId, url: 'https://attacker.example/popup.html' }],
    [{ type: 'bridge.connect', extra: true }, { id: extensionId, url: popupUrl }],
    [{ type: 'bridge.unknown' }, { id: extensionId, url: popupUrl }]
  ])('rejects untrusted source or malformed command %#', (message, sender) => {
    expect(isTrustedPopupCommand(message, sender, extensionId, popupUrl)).toBe(false)
  })
})
