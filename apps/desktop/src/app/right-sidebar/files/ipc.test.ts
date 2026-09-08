/// <reference types="node" />

import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesReadDirEntry, HermesReadDirResult } from '@/global'

import { readProjectDir } from './ipc'

const readDir = vi.fn<(path: string) => Promise<HermesReadDirResult>>()
const readFileDataUrl = vi.fn<(path: string) => Promise<string>>()
const gitRoot = vi.fn<(path: string) => Promise<string | null>>()

function ok(entries: HermesReadDirEntry[]): HermesReadDirResult {
  return { entries }
}

function dataUrl(text: string) {
  return `data:text/plain;base64,${Buffer.from(text, 'utf8').toString('base64')}`
}

function installBridge() {
  ;(
    window as unknown as {
      hermesDesktop: {
        gitRoot: typeof gitRoot
        readDir: typeof readDir
        readFileDataUrl: typeof readFileDataUrl
      }
    }
  ).hermesDesktop = { gitRoot, readDir, readFileDataUrl }
}

describe('readProjectDir', () => {
  it('shows environment files and local directories even when Git ignores them', async () => {
    gitRoot.mockResolvedValue('/repo')

    const entries = ['.gitignore', '.env', '.env.local', '.env.example', 'local-config'].map(name => ({
      name,
      path: `/repo/${name}`,
      isDirectory: name === 'local-config'
    }))

    readDir.mockResolvedValue(ok(entries))
    readFileDataUrl.mockResolvedValue(dataUrl('.env\n.env.*\n!.env.example\nlocal-config/\n'))

    const result = await readProjectDir('/repo')

    expect(result.entries).toEqual(entries)
  })

  beforeEach(() => {
    readDir.mockReset()
    readFileDataUrl.mockReset()
    gitRoot.mockReset()
    installBridge()
  })

  afterEach(() => {
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  it('returns no-bridge when the desktop bridge is unavailable', async () => {
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop

    await expect(readProjectDir('/repo')).resolves.toEqual({ entries: [], error: 'no-bridge' })
  })

  it('preserves ignored entries and Windows-style paths', async () => {
    gitRoot.mockResolvedValue('C:\\repo')
    readDir.mockImplementation(async path => {
      if (path === 'C:\\repo\\src') {
        return ok([
          { name: 'debug.log', path: 'C:\\repo\\src\\debug.log', isDirectory: false },
          { name: '临时.txt', path: 'C:\\repo\\src\\临时.txt', isDirectory: false },
          { name: 'keep.ts', path: 'C:\\repo\\src\\keep.ts', isDirectory: false }
        ])
      }

      if (path === 'C:/repo') {
        return ok([{ name: '.gitignore', path: 'C:/repo/.gitignore', isDirectory: false }])
      }

      if (path === 'C:/repo/src') {
        return ok([])
      }

      return ok([])
    })
    readFileDataUrl.mockResolvedValue(dataUrl('# Unicode 路径规则\nsrc/*.log\nsrc/临时.txt\n'))

    const result = await readProjectDir('C:\\repo\\src')

    expect(result.entries.map(entry => entry.name)).toEqual(['debug.log', '临时.txt', 'keep.ts'])
    expect(gitRoot).not.toHaveBeenCalled()
    expect(readFileDataUrl).not.toHaveBeenCalled()
  })

  it('preserves ignored entries with differently cased Windows paths', async () => {
    gitRoot.mockResolvedValue('C:\\Repo')
    readDir.mockImplementation(async path => {
      if (path === 'c:\\repo\\src') {
        return ok([
          { name: 'debug.log', path: 'c:\\repo\\src\\debug.log', isDirectory: false },
          { name: 'keep.ts', path: 'c:\\repo\\src\\keep.ts', isDirectory: false }
        ])
      }

      if (path === 'C:/Repo') {
        return ok([{ name: '.gitignore', path: 'C:/Repo/.gitignore', isDirectory: false }])
      }

      if (path === 'C:/Repo/src') {
        return ok([])
      }

      return ok([])
    })
    readFileDataUrl.mockResolvedValue(dataUrl('src/*.log\n'))

    const result = await readProjectDir('c:\\repo\\src')

    expect(result.entries.map(entry => entry.name)).toEqual(['debug.log', 'keep.ts'])
  })

  it('does not fetch .gitignore contents when listings do not contain .gitignore', async () => {
    gitRoot.mockResolvedValue('/repo')
    readDir.mockImplementation(async path => {
      if (path === '/repo/src') {
        return ok([{ name: 'debug.log', path: '/repo/src/debug.log', isDirectory: false }])
      }

      return ok([])
    })

    const result = await readProjectDir('/repo/src')

    expect(result.entries.map(entry => entry.name)).toEqual(['debug.log'])
    expect(readFileDataUrl).not.toHaveBeenCalled()
  })
})
