import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PageRuntimeServiceError } from './page-runtime-service.js';
import { createPageRuntimeService } from './page-runtime-service.js'

const originalConsole = {
  debug: console.debug,
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn
}

function installChromeExecutor(implementation?: (request: { args: unknown[], func: (...args: never[]) => unknown }) => Promise<unknown>) {
  const executeScript = vi.fn(async request => [{
    result: await (implementation ?? (async ({ args, func }) => func(...args as never[])))(request)
  }])

  vi.stubGlobal('chrome', {
    scripting: { executeScript }
  })

  return executeScript
}

function installPageGlobals(evalResult: unknown = undefined) {
  vi.stubGlobal('window', {
    eval: vi.fn(async () => evalResult)
  })
  vi.stubGlobal('document', {
    getElementById: vi.fn(() => undefined),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => [])
  })
}

afterEach(() => {
  console.debug = originalConsole.debug
  console.error = originalConsole.error
  console.info = originalConsole.info
  console.log = originalConsole.log
  console.warn = originalConsole.warn
  vi.unstubAllGlobals()
})

describe('extension-owned page runtime service', () => {
  it('redacts credential-shaped eval string values', async () => {
    installPageGlobals({
      access: 'access_token=super-secret-token',
      authorization: 'Authorization: Bearer super-secret-token',
      nested: { client: 'client_secret=super-secret-token' }
    })
    installChromeExecutor()

    await expect(createPageRuntimeService().eval(7, {
      source: 'document.title',
      timeoutMs: 500
    })).resolves.toEqual({
      access: '[redacted]',
      authorization: '[redacted]',
      nested: { client: '[redacted]' }
    })
  })

  it('redacts credential-shaped console string arguments', async () => {
    installPageGlobals()
    installChromeExecutor()
    const service = createPageRuntimeService()

    await service.console(7, { limit: 10 })
    console.error('api_key=super-secret-token', 'access_token=super-secret-token', 'client_secret=super-secret-token')

    await expect(service.console(7, { levels: ['error'], limit: 10 })).resolves.toMatchObject({
      entries: [
        {
          arguments: ['[redacted]', '[redacted]', '[redacted]'],
          level: 'error'
        }
      ]
    })
  })

  it('bounds never-settling eval calls by the requested timeout', async () => {
    installChromeExecutor(async () => new Promise(() => undefined))
    const started = Date.now()

    await expect(createPageRuntimeService().eval(7, {
      source: 'await new Promise(() => undefined)',
      timeoutMs: 100
    })).rejects.toMatchObject({ code: 'RUNTIME_TIMEOUT' } satisfies Partial<PageRuntimeServiceError>)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
