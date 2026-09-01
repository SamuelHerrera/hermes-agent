import { describe, expect, it } from 'vitest'

import { runtimeChannelAuth } from './page-runtime-channel.js'
import {
  createPageRuntimeClient,
  MAIN_REQUEST_EVENT,
  MAIN_RESPONSE_EVENT,
  PageRuntimeClientError
} from './page-runtime-client.js'

class DetailEvent extends Event {
  public readonly detail: string

  public constructor(type: string, options: string | { detail: string }) {
    super(type)
    this.detail = typeof options === 'string' ? options : options.detail
  }
}

class FakeWindow extends EventTarget {
  public readonly CustomEvent = DetailEvent
  public readonly crypto = { randomUUID: () => 'request-1' }
}

describe('isolated-to-main page runtime client', () => {
  it('routes eval and console requests through bounded JSON events', async () => {
    const window = new FakeWindow()
    window.addEventListener(MAIN_REQUEST_EVENT, event => {
      const request = JSON.parse((event as DetailEvent).detail) as { id: string, kind: string }
      const result = request.kind === 'eval' ? { title: 'Test' } : { count: 1, entries: [], truncated: false }

      const response = {
        id: request.id,
        ok: true,
        result
      }

      void runtimeChannelAuth(response).then(auth => {
        window.dispatchEvent(new DetailEvent(MAIN_RESPONSE_EVENT, JSON.stringify({ ...response, auth })))
      })
    })
    const client = createPageRuntimeClient(window as unknown as Window)

    await expect(client.eval({ source: 'document.title', timeoutMs: 500 })).resolves.toEqual({ title: 'Test' })
    await expect(client.console({ levels: ['error'], limit: 10, timeoutMs: 500 })).resolves.toMatchObject({ count: 1 })
  })

  it('maps main-world errors without returning request source', async () => {
    const window = new FakeWindow()
    window.addEventListener(MAIN_REQUEST_EVENT, event => {
      const request = JSON.parse((event as DetailEvent).detail) as { id: string }

      const response = {
        error: { code: 'SENSITIVE_PAGE', message: 'Evaluation is blocked.' },
        id: request.id,
        ok: false
      }

      void runtimeChannelAuth(response).then(auth => {
        window.dispatchEvent(new DetailEvent(MAIN_RESPONSE_EVENT, JSON.stringify({ ...response, auth })))
      })
    })
    const client = createPageRuntimeClient(window as unknown as Window)

    try {
      await client.eval({ source: 'secret source', timeoutMs: 500 })
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(PageRuntimeClientError)
      expect((error as PageRuntimeClientError).code).toBe('SENSITIVE_PAGE')
      expect((error as Error).message).not.toContain('secret source')
    }
  })
})
