import { describe, expect, it, vi } from 'vitest'

import {
  createConsoleRecorder,
  executeGuardedEval,
  RuntimeGuardError
} from './page-runtime-core.js'

describe('guarded main-world runtime', () => {
  it('awaits eval results and returns bounded structured values', async () => {
    const evaluate = vi.fn(async () => ({ nested: { ok: true }, values: [1, 2, 3] }))

    await expect(executeGuardedEval({
      evaluate,
      hasSensitiveFields: false,
      source: 'Promise.resolve({ ok: true })'
    })).resolves.toEqual({ nested: { ok: true }, values: [1, 2, 3] })
    expect(evaluate).toHaveBeenCalledWith('Promise.resolve({ ok: true })')
  })

  it('refuses sensitive pages and redacts credentials from results and console entries', async () => {
    await expect(executeGuardedEval({
      evaluate: async () => 'not reached',
      hasSensitiveFields: true,
      source: 'document.title'
    })).rejects.toMatchObject({ code: 'SENSITIVE_PAGE' })

    const result = await executeGuardedEval({
      evaluate: async () => ({ password: 'password=hunter2', token: 'ghp_abcdefghijklmnopqrstuvwxyz123456' }),
      hasSensitiveFields: false,
      source: 'safe expression'
    })

    expect(JSON.stringify(result)).not.toContain('hunter2')
    expect(JSON.stringify(result)).not.toContain('ghp_')

    const recorder = createConsoleRecorder(3)
    recorder.add('error', ['Authorization: Bearer secret-token', { ok: false }])
    expect(JSON.stringify(recorder.list({ limit: 2 }))).not.toContain('secret-token')
  })

  it('bounds cyclic results, source size, console ring size, and list limits', async () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    const result = await executeGuardedEval({
      evaluate: async () => cyclic,
      hasSensitiveFields: false,
      source: 'cyclic'
    })

    expect(JSON.stringify(result)).toContain('[circular]')

    await expect(executeGuardedEval({
      evaluate: async () => undefined,
      hasSensitiveFields: false,
      source: 'x'.repeat(100_001)
    })).rejects.toBeInstanceOf(RuntimeGuardError)

    const recorder = createConsoleRecorder(2)
    recorder.add('log', ['one'])
    recorder.add('warn', ['two'])
    recorder.add('error', ['three'])

    expect(recorder.list({ limit: 100 }).entries.map(entry => entry.level)).toEqual(['warn', 'error'])
  })
})
