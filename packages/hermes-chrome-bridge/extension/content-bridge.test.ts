import { describe, expect, it, vi } from 'vitest'

import { createContentBridgeHandler } from './content-bridge.js'

function setup() {
  const inspector = {
    query: vi.fn(() => ({ count: 0, elements: [], format: 'both' as const, truncated: false, version: 1 as const })),
    snapshot: vi.fn(() => ({ count: 0, elements: [], format: 'both' as const, truncated: false, version: 1 as const }))
  }

  return { handler: createContentBridgeHandler(inspector), inspector }
}

describe('content bridge protocol', () => {
  it('routes strict snapshot and query messages', () => {
    const { handler, inspector } = setup()

    expect(handler({ format: 'both', type: 'hermes.bridge.snapshot', version: 1 })).toMatchObject({
      type: 'hermes.bridge.result',
      version: 1
    })
    expect(inspector.snapshot).toHaveBeenCalledWith({ format: 'both' })

    expect(handler({ limit: 4, selector: 'button', type: 'hermes.bridge.query', version: 1 })).toMatchObject({
      type: 'hermes.bridge.result',
      version: 1
    })
    expect(inspector.query).toHaveBeenCalledWith({ limit: 4, selector: 'button' })
  })

  it('ignores malformed, extra-key, and unsupported messages', () => {
    const { handler, inspector } = setup()

    for (const message of [
      null,
      { format: 'both', secret: 'do not echo', type: 'hermes.bridge.snapshot', version: 1 },
      { format: 'invalid', type: 'hermes.bridge.snapshot', version: 1 },
      { limit: 0, selector: 'button', type: 'hermes.bridge.query', version: 1 },
      { selector: '', type: 'hermes.bridge.query', version: 1 },
      { type: 'other', version: 1 }
    ]) {
      expect(handler(message)).toBeUndefined()
    }

    expect(inspector.snapshot).not.toHaveBeenCalled()
    expect(inspector.query).not.toHaveBeenCalled()
  })
})
