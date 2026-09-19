import { describe, expect, it, vi } from 'vitest'

import { buildRenderers } from './build-renderers.mjs'

describe('release renderer build', () => {
  it('builds and verifies the browser renderer after the Electron renderer', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const assertBrowserBundle = vi.fn().mockResolvedValue(undefined)

    await buildRenderers({ assertBrowserBundle, run })

    expect(run.mock.calls).toEqual([
      [['build']],
      [['build', '--mode', 'browser']]
    ])
    expect(assertBrowserBundle).toHaveBeenCalledOnce()
    expect(run.mock.invocationCallOrder[1]).toBeLessThan(assertBrowserBundle.mock.invocationCallOrder[0])
  })
})