import { describe, expect, it, vi } from 'vitest'

import { createContentBridgeHandler } from './content-bridge.js'

function setup() {
  const actions = {
    click: vi.fn(() => ({ clicked: true as const, ref: 'e1' })),
    hover: vi.fn(() => ({ hovered: true as const, ref: 'e1' })),
    key: vi.fn(() => ({ key: 'Enter', pressed: true as const })),
    scroll: vi.fn(() => ({ scrolled: true as const })),
    type: vi.fn(() => ({ ref: 'e1', submitted: false, typedLength: 4 }))
  }

  const inspector = {
    query: vi.fn(() => ({ count: 0, elements: [], format: 'both' as const, truncated: false, version: 1 as const })),
    resolve: vi.fn(),
    snapshot: vi.fn(() => ({ count: 0, elements: [], format: 'both' as const, truncated: false, version: 1 as const }))
  }

  const indicator = { activity: vi.fn(), destroy: vi.fn(), hide: vi.fn(), refresh: vi.fn() }

  return {
    actions,
    handler: createContentBridgeHandler(inspector, actions, indicator),
    indicator,
    inspector
  }
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

  it('routes strict user-like action messages without echoing typed text', async () => {
    const { actions, handler } = setup()

    const responses = await Promise.all([
      handler({ button: 'left', target: 'e1', type: 'hermes.bridge.click', version: 1 }),
      handler({ submit: false, target: 'e1', text: 'safe', type: 'hermes.bridge.type', version: 1 }),
      handler({ key: 'Enter', modifiers: ['ctrl'], type: 'hermes.bridge.key', version: 1 }),
      handler({ deltaX: 0, deltaY: 50, type: 'hermes.bridge.scroll', version: 1 }),
      handler({ target: 'e1', type: 'hermes.bridge.hover', version: 1 })
    ].map(async response => response))

    expect(actions.click).toHaveBeenCalledWith({ button: 'left', target: 'e1' })
    expect(actions.type).toHaveBeenCalledWith({ submit: false, target: 'e1', text: 'safe' })
    expect(actions.key).toHaveBeenCalledWith({ key: 'Enter', modifiers: ['ctrl'] })
    expect(actions.scroll).toHaveBeenCalledWith({ deltaX: 0, deltaY: 50 })
    expect(actions.hover).toHaveBeenCalledWith({ target: 'e1' })
    expect(responses.every(response => response?.type === 'hermes.bridge.result')).toBe(true)
    expect(JSON.stringify(responses)).not.toContain('safe')
  })

  it('ignores invalid action payloads before invoking page actions', () => {
    const { actions, handler } = setup()

    for (const message of [
      { button: 'invalid', target: 'e1', type: 'hermes.bridge.click', version: 1 },
      { submit: false, target: 'e1', text: 'x', type: 'hermes.bridge.type', version: 1, extra: true },
      { key: '', modifiers: [], type: 'hermes.bridge.key', version: 1 },
      { deltaX: 0, deltaY: Number.POSITIVE_INFINITY, type: 'hermes.bridge.scroll', version: 1 },
      { target: '', type: 'hermes.bridge.hover', version: 1 }
    ]) {
      expect(handler(message)).toBeUndefined()
    }

    expect(actions.click).not.toHaveBeenCalled()
    expect(actions.type).not.toHaveBeenCalled()
    expect(actions.key).not.toHaveBeenCalled()
    expect(actions.scroll).not.toHaveBeenCalled()
    expect(actions.hover).not.toHaveBeenCalled()
  })

  it('hides the indicator when bridge control disconnects', () => {
    const { handler, indicator } = setup()

    expect(handler({ active: false, type: 'hermes.bridge.indicator', version: 1 })).toMatchObject({
      result: { active: false },
      type: 'hermes.bridge.result'
    })
    expect(indicator.hide).toHaveBeenCalledOnce()
  })

  it('refreshes the indicator position before a screenshot', () => {
    const { handler, indicator } = setup()

    expect(handler({ type: 'hermes.bridge.indicator.refresh', version: 1 })).toMatchObject({
      result: { refreshed: true },
      type: 'hermes.bridge.result'
    })
    expect(indicator.refresh).toHaveBeenCalledOnce()
  })

  it('does not expose eval or console through page-observable content messages', () => {
    const { handler } = setup()

    expect(handler({
      source: 'document.title',
      timeoutMs: 500,
      type: 'hermes.bridge.eval',
      version: 1
    })).toBeUndefined()
    expect(handler({
      levels: ['error'],
      limit: 10,
      timeoutMs: 500,
      type: 'hermes.bridge.console',
      version: 1
    })).toBeUndefined()
  })
})
