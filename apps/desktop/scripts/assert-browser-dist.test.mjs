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
  it('accepts an emitted entry graph that contains the browser bootstrap sentinel', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'hermes-browser-dist-'))
    await mkdir(path.join(root, 'assets'))
    await writeFile(path.join(root, 'index.html'), '<script type="module" src="./assets/index-a1b2c3.js"></script>')
    await writeFile(path.join(root, 'assets', 'index-a1b2c3.js'), "import './browser-entry-d4e5f6.js'")
    await writeFile(
      path.join(root, 'assets', 'browser-entry-d4e5f6.js'),
      "window.__HERMES_BROWSER_ENTRY__='hermes-browser-bootstrap:v1'"
    )

    await expect(assertBrowserDist(root)).resolves.toBeUndefined()
  })

  it('rejects an emitted Electron-only main entry', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'hermes-browser-dist-'))
    await mkdir(path.join(root, 'assets'))
    await writeFile(path.join(root, 'index.html'), '<script type="module" src="./assets/index-a1b2c3.js"></script>')
    await writeFile(path.join(root, 'assets', 'index-a1b2c3.js'), 'window.hermesDesktop?.getVersions()')

    await expect(assertBrowserDist(root)).rejects.toThrow(/browser bootstrap sentinel/i)
  })

  it('rejects a stale source entry instead of treating it as a browser build', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'hermes-browser-dist-'))
    await writeFile(path.join(root, 'index.html'), '<script type="module" src="/src/main.tsx"></script>')

    await expect(assertBrowserDist(root)).rejects.toThrow(/emitted browser entry/i)
  })
})
