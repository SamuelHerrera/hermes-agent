import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from './test'
import { setupPackagedApp } from './fixtures'

// Exercise the shipped preload -> Electron IPC -> filesystem path, not just
// the renderer tree. All content is synthetic and stays in the sandbox.
test('packaged explorer can list open save and reopen project configuration files', async () => {
  const fixture = await setupPackagedApp()
  const root = path.join(fixture.sandbox.hermesHome, 'project')
  fs.mkdirSync(root, { recursive: true })
  const names = ['.env', '.env.local', '.envrc', '.npmrc', '.netrc', '.pypirc', 'cert.pem', 'auth.json']

  try {
    for (const name of names) {
      fs.writeFileSync(path.join(root, name), 'FIXTURE_VALUE=before\n')
    }

    const results = await fixture.page.evaluate(async ({ root, names }) => {
      const desktop = (window as typeof window & {
        hermesDesktop: {
          readDir: (path: string) => Promise<{ entries: { name: string }[] }>
          readFileText: (path: string) => Promise<{ text: string; binary: boolean; truncated: boolean }>
          writeTextFile: (path: string, content: string) => Promise<{ path: string }>
          readFileDataUrl: (path: string) => Promise<string>
        }
      }).hermesDesktop
      const listing = await desktop.readDir(root)
      const results = []

      for (const name of names) {
        const filePath = `${root}/${name}`
        const before = await desktop.readFileText(filePath)
        await desktop.writeTextFile(filePath, 'FIXTURE_VALUE=after\n')
        const after = await desktop.readFileText(filePath)
        const dataUrl = await desktop.readFileDataUrl(filePath)
        results.push({ name, listed: listing.entries.some(entry => entry.name === name), before, after, dataUrl })
      }

      return results
    }, { root, names })

    for (const result of results) {
      expect(result.listed, result.name).toBe(true)
      expect(result.before.text, result.name).toBe('FIXTURE_VALUE=before\n')
      expect(result.before.binary, result.name).toBe(false)
      expect(result.after.text, result.name).toBe('FIXTURE_VALUE=after\n')
      expect(result.after.truncated, result.name).toBe(false)
      expect(Buffer.from(result.dataUrl.split(',')[1], 'base64').toString(), result.name).toBe('FIXTURE_VALUE=after\n')
      expect(fs.readFileSync(path.join(root, result.name), 'utf8')).toBe('FIXTURE_VALUE=after\n')
    }
  } finally {
    await fixture.cleanup()
  }
})
