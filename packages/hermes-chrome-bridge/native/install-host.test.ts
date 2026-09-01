import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveHermesHome } from '../src/runtime.js'

import { installNativeHost, parseInstallerArgs } from './install-host.js'
import {
  buildNativeHostManifest,
  HOST_NAME,
  nativeManifestPath,
  normalizeExtensionOrigin,
  originFromExtensionId
} from './manifest.js'

const temporaryDirectories: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async directory => {
    await rm(directory, { force: true, recursive: true })
  }))
})

describe('native host origin and manifest', () => {
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
  const origin = `chrome-extension://${extensionId}/`

  it('authorizes only the exact extension origin and one documented trailing slash', () => {
    expect(originFromExtensionId(extensionId)).toBe(origin)
    expect(normalizeExtensionOrigin(origin)).toBe(origin)
    expect(normalizeExtensionOrigin(origin.slice(0, -1))).toBe(origin)
    expect(() => normalizeExtensionOrigin(`${origin}extra`)).toThrow('invalid Chrome extension origin')
    expect(() => normalizeExtensionOrigin('https://example.com/')).toThrow('invalid Chrome extension origin')
    expect(() => originFromExtensionId(`${extensionId}a`)).toThrow('invalid Chrome extension ID')
  })

  it('builds exact Chrome manifest content and pure platform-specific paths', () => {
    expect(buildNativeHostManifest('/absolute/wrapper', origin)).toEqual({
      allowed_origins: [origin],
      description: 'Hermes Chrome Bridge native messaging host',
      name: HOST_NAME,
      path: '/absolute/wrapper',
      type: 'stdio'
    })
    expect(nativeManifestPath('/Users/test', 'darwin')).toBe(
      `/Users/test/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json`
    )
    expect(nativeManifestPath('/home/test', 'linux')).toBe(
      `/home/test/.config/google-chrome/NativeMessagingHosts/${HOST_NAME}.json`
    )
    expect(() => nativeManifestPath('C:\\Users\\test', 'win32')).toThrow(
      'Windows native host installation requires a signed executable launcher'
    )
  })

  it('resolves Hermes home with CLI precedence and internal fallbacks', () => {
    expect(resolveHermesHome('/cli/home', '/env/home', '/Users/test')).toBe('/cli/home')
    expect(resolveHermesHome(undefined, '/env/home', '/Users/test')).toBe('/env/home')
    expect(resolveHermesHome(undefined, undefined, '/Users/test')).toBe('/Users/test/.hermes')
  })

  it('parses explicit temp-safe CLI destinations', () => {
    expect(parseInstallerArgs([
      '--extension-id', extensionId,
      '--hermes-home', '/tmp/hermes-profile',
      '--manifest-directory', '/tmp/chrome-manifests'
    ])).toEqual({
      extensionId,
      hermesHome: '/tmp/hermes-profile',
      manifestDirectory: '/tmp/chrome-manifests'
    })
  })

  it('executes the built installer through an npm-style bin symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hcb-bin-'))
    temporaryDirectories.push(root)
    const binDirectory = join(root, 'node_modules', '.bin')
    const binPath = join(binDirectory, 'hermes-chrome-bridge-install-host')
    const hermesHome = join(root, 'hermes-home')
    const manifestDirectory = join(root, 'manifests')
    await mkdir(binDirectory, { recursive: true })
    await symlink(resolve('dist/native/install-host.js'), binPath)

    await execFileAsync(process.execPath, [
      binPath,
      '--extension-id', extensionId,
      '--hermes-home', hermesHome,
      '--manifest-directory', manifestDirectory
    ])

    const manifest = JSON.parse(await readFile(
      join(manifestDirectory, `${HOST_NAME}.json`),
      'utf8'
    )) as Record<string, unknown>

    expect(manifest).toMatchObject({ allowed_origins: [origin], name: HOST_NAME })
  })

  it('installs private runtime files and an absolute executable wrapper in temp destinations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-bridge-install-'))
    temporaryDirectories.push(root)
    const hermesHome = join(root, 'profile-home')
    const manifestDirectory = join(root, 'manifests')
    const builtHostPath = join(root, 'package', 'dist', 'native', 'host.js')

    const result = await installNativeHost({
      builtHostPath,
      extensionId,
      hermesHome,
      manifestDirectory,
      nodePath: '/absolute/node'
    })

    expect(result.manifestPath).toBe(join(manifestDirectory, `${HOST_NAME}.json`))
    expect((await stat(result.runtimeDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(result.configPath)).mode & 0o777).toBe(0o600)
    expect((await stat(result.statusPath)).mode & 0o777).toBe(0o600)
    expect((await stat(result.wrapperPath)).mode & 0o777).toBe(0o700)

    const wrapper = await readFile(result.wrapperPath, 'utf8')
    expect(wrapper).toContain("exec '/absolute/node' '")
    expect(wrapper).toContain(builtHostPath)
    expect(wrapper).toContain(`'${result.configPath}'`)
    expect(wrapper).toContain('"$@"')
    expect(wrapper).not.toContain('/usr/bin/env')

    const config = JSON.parse(await readFile(result.configPath, 'utf8')) as Record<string, unknown>
    expect(config).toMatchObject({ origin, version: 1 })
    expect(config.token).toMatch(/^[a-f0-9]{64}$/)
    expect(config.socketPath).toBe(join(result.runtimeDirectory, 'broker.sock'))

    const status = JSON.parse(await readFile(result.statusPath, 'utf8')) as Record<string, unknown>
    expect(status).toEqual({ connected: false, updatedAt: expect.any(String), version: 1 })
  })
})
