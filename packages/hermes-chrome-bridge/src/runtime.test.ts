import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { writePrivateJson } from './runtime.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async directory => {
    await rm(directory, { force: true, recursive: true })
  }))
})

describe('private runtime JSON writes', () => {
  it('atomically handles repeated concurrent writes without temp collisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hermes-runtime-write-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'status.json')

    await Promise.all(Array.from({ length: 50 }, async (_, sequence) => {
      await writePrivateJson(path, { sequence })
    }))

    const parsed = JSON.parse(await readFile(path, 'utf8')) as { sequence: number }
    expect(parsed.sequence).toBeGreaterThanOrEqual(0)
    expect(parsed.sequence).toBeLessThan(50)
    expect(await readdir(directory)).toEqual(['status.json'])
  })
})
