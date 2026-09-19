import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { assertBrowserDist } from './assert-browser-dist.mjs'

let root

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('browser bundle smoke assertion', () => {
  it('accepts an index that points at emitted hashed assets', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'hermes-browser-dist-'))
    await mkdir(path.join(root, 'assets'))
    await writeFile(path.join(root, 'index.html'), '<script type="module" src="./assets/index-a1b2c3.js"></script>')
    await writeFile(path.join(root, 'assets', 'index-a1b2c3.js'), 'window.ok=true')

    await expect(assertBrowserDist(root)).resolves.toBeUndefined()
  })

  it('rejects a stale source entry instead of treating it as a browser build', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'hermes-browser-dist-'))
    await writeFile(path.join(root, 'index.html'), '<script type="module" src="/src/main.tsx"></script>')

    await expect(assertBrowserDist(root)).rejects.toThrow(/emitted browser entry/i)
  })
})
