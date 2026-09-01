import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { deriveExtensionId } from './extension-id.js'

const outputDirectory = join(process.cwd(), 'dist', 'extension')

async function readBuiltManifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(outputDirectory, 'manifest.json'), 'utf8')) as Record<string, unknown>
}

describe('built MV3 extension artifacts', () => {
  it('emits an installable module-worker shell without removing server/native outputs', async () => {
    const manifest = await readBuiltManifest()

    expect(manifest).toMatchObject({
      background: { service_worker: 'background.js', type: 'module' },
      host_permissions: ['<all_urls>'],
      manifest_version: 3,
      permissions: ['nativeMessaging', 'storage']
    })
    expect(manifest.permissions).not.toEqual(expect.arrayContaining(['activeTab', 'tabs', 'scripting']))
    expect(manifest.content_scripts).toEqual(expect.arrayContaining([
      expect.objectContaining({ js: ['main-world.js'], run_at: 'document_start', world: 'MAIN' }),
      expect.objectContaining({ js: ['content-script.js'], run_at: 'document_idle' })
    ]))
    await expect(stat(join(outputDirectory, 'background.js'))).resolves.toBeDefined()
    await expect(stat(join(outputDirectory, 'content-script.js'))).resolves.toBeDefined()
    await expect(stat(join(outputDirectory, 'main-world.js'))).resolves.toBeDefined()
    await expect(stat(join(outputDirectory, 'popup.js'))).resolves.toBeDefined()
    await expect(stat(join(outputDirectory, 'popup.html'))).resolves.toBeDefined()
    await expect(stat(join(outputDirectory, 'popup.css'))).resolves.toBeDefined()
    await expect(stat(join(process.cwd(), 'dist', 'server.js'))).resolves.toBeDefined()
    await expect(stat(join(process.cwd(), 'dist', 'native', 'host.js'))).resolves.toBeDefined()
  })

  it('keeps the manifest public key and extension ID stable', async () => {
    const manifest = await readBuiltManifest()

    expect(typeof manifest.key).toBe('string')
    await expect(deriveExtensionId(manifest.key as string)).resolves.toBe(
      'mdeahbanbmncnmkjkklglmdflkcclckg'
    )
  })
})
