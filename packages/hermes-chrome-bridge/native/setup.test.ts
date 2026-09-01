import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  checkChromeBridgeSetup,
  installChromeBridgeSetup,
  STABLE_EXTENSION_ID
} from './setup.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')

  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hermes-chrome-setup-'))
  temporaryDirectories.push(root)
  const extensionSource = join(root, 'built-extension')
  const hermesHome = join(root, 'hermes-home')
  const manifestDirectory = join(root, 'native-manifests')
  const runtimeSourceDirectory = join(root, 'built-runtime')
  const builtHostPath = join(runtimeSourceDirectory, 'native', 'host.js')

  await mkdir(extensionSource, { recursive: true })
  await mkdir(join(runtimeSourceDirectory, 'native'), { recursive: true })
  await mkdir(join(runtimeSourceDirectory, 'src'), { recursive: true })
  await writeFile(join(extensionSource, 'manifest.json'), JSON.stringify({ manifest_version: 3 }))
  await writeFile(join(extensionSource, 'background.js'), '/* built */')
  await writeFile(builtHostPath, '/* host */')
  await writeFile(join(runtimeSourceDirectory, 'src', 'runtime.js'), '/* runtime */')

  return { extensionSource, hermesHome, manifestDirectory, root, runtimeSourceDirectory }
}

describe('Chrome bridge setup CLI core', () => {
  it('installs a stable unpacked extension and native host into explicit locations', async () => {
    const paths = await fixture()

    const result = await installChromeBridgeSetup({
      ...paths,
      nodePath: process.execPath,
      platform: 'darwin',
      userHome: paths.root
    })

    expect(result.extensionId).toBe(STABLE_EXTENSION_ID)
    expect(JSON.parse(await readFile(join(result.extensionDirectory, 'manifest.json'), 'utf8'))).toMatchObject({
      manifest_version: 3
    })
    expect(result.nativeHost.manifestPath.startsWith(paths.manifestDirectory)).toBe(true)
    expect(await readFile(result.nativeHost.wrapperPath, 'utf8')).toContain(
      join(paths.hermesHome, 'chrome-bridge', 'runtime', 'native', 'host.js')
    )

    await expect(checkChromeBridgeSetup({
      extensionDirectory: result.extensionDirectory,
      hermesHome: paths.hermesHome,
      nativeManifestPath: result.nativeHost.manifestPath
    })).resolves.toMatchObject({
      extensionInstalled: true,
      nativeConnected: false,
      nativeHostInstalled: true,
      ready: false
    })
  })

  it('reports ready only after the authenticated native host is connected', async () => {
    const paths = await fixture()

    const result = await installChromeBridgeSetup({
      ...paths,
      nodePath: process.execPath,
      platform: 'darwin',
      userHome: paths.root
    })

    await writeFile(result.nativeHost.statusPath, JSON.stringify({
      connected: true,
      updatedAt: '2026-08-31T00:00:00.000Z',
      version: 1
    }))

    await expect(checkChromeBridgeSetup({
      extensionDirectory: result.extensionDirectory,
      hermesHome: paths.hermesHome,
      nativeManifestPath: result.nativeHost.manifestPath
    })).resolves.toMatchObject({ nativeConnected: true, ready: true })
  })
})
