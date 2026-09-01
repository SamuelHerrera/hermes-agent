#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveHermesHome, runtimeDirectoryFor } from '../src/runtime.js'

import { installNativeHost, type InstallNativeHostResult } from './install-host.js'
import { HOST_NAME, nativeManifestPath } from './manifest.js'

export const STABLE_EXTENSION_ID = 'mdeahbanbmncnmkjkklglmdflkcclckg'

export interface InstallChromeBridgeSetupOptions {
  builtHostPath: string
  extensionSource: string
  hermesHome?: string
  manifestDirectory?: string
  nodePath?: string
  platform?: NodeJS.Platform
  userHome?: string
}

export interface ChromeBridgeSetupResult {
  extensionDirectory: string
  extensionId: string
  nativeHost: InstallNativeHostResult
}

export interface ChromeBridgeSetupStatus {
  extensionInstalled: boolean
  extensionPath: string
  nativeConnected: boolean
  nativeHostInstalled: boolean
  nativeManifestPath: string
  ready: boolean
  version: 1
}

async function regularJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(path, 'utf8')

    if (raw.length > 64 * 1024) { return undefined }
    const parsed: unknown = JSON.parse(raw)

    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

export async function installChromeBridgeSetup(
  options: InstallChromeBridgeSetupOptions
): Promise<ChromeBridgeSetupResult> {
  const hermesHome = resolveHermesHome(options.hermesHome)
  const extensionSource = resolve(options.extensionSource)
  const sourceManifest = await regularJsonFile(join(extensionSource, 'manifest.json'))

  if (sourceManifest?.manifest_version !== 3) {
    throw new Error('the built Chrome extension is missing or invalid')
  }

  const extensionDirectory = join(hermesHome, 'chrome-bridge', 'extension')

  await rm(extensionDirectory, { force: true, recursive: true })
  await mkdir(dirname(extensionDirectory), { recursive: true })
  await cp(extensionSource, extensionDirectory, { recursive: true })

  const nativeHost = await installNativeHost({
    builtHostPath: options.builtHostPath,
    extensionId: STABLE_EXTENSION_ID,
    hermesHome,
    manifestDirectory: options.manifestDirectory,
    nodePath: options.nodePath,
    platform: options.platform,
    userHome: options.userHome
  })

  return { extensionDirectory, extensionId: STABLE_EXTENSION_ID, nativeHost }
}

export async function checkChromeBridgeSetup(options: {
  extensionDirectory?: string
  hermesHome?: string
  nativeManifestPath?: string
  platform?: NodeJS.Platform
  userHome?: string
} = {}): Promise<ChromeBridgeSetupStatus> {
  const hermesHome = resolveHermesHome(options.hermesHome)
  const platform = options.platform ?? process.platform
  const userHome = options.userHome ?? homedir()
  const extensionDirectory = resolve(options.extensionDirectory ?? join(hermesHome, 'chrome-bridge', 'extension'))
  const manifestPath = resolve(options.nativeManifestPath ?? nativeManifestPath(userHome, platform))
  const extensionManifest = await regularJsonFile(join(extensionDirectory, 'manifest.json'))
  const hostManifest = await regularJsonFile(manifestPath)
  const status = await regularJsonFile(join(runtimeDirectoryFor(hermesHome), 'status.json'))
  const extensionInstalled = extensionManifest?.manifest_version === 3

  const nativeHostInstalled = hostManifest?.name === HOST_NAME &&
    Array.isArray(hostManifest.allowed_origins) &&
    hostManifest.allowed_origins.includes(`chrome-extension://${STABLE_EXTENSION_ID}/`)

  const nativeConnected = status?.connected === true && status.version === 1

  return {
    extensionInstalled,
    extensionPath: extensionDirectory,
    nativeConnected,
    nativeHostInstalled,
    nativeManifestPath: manifestPath,
    ready: extensionInstalled && nativeHostInstalled && nativeConnected,
    version: 1
  }
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)

  return index === -1 ? undefined : args[index + 1]
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'check'
  const hermesHome = valueAfter(args, '--hermes-home')
  const manifestDirectory = valueAfter(args, '--manifest-directory')

  if (command === 'install') {
    const result = await installChromeBridgeSetup({
      builtHostPath: fileURLToPath(new URL('./host.js', import.meta.url)),
      extensionSource: fileURLToPath(new URL('../extension', import.meta.url)),
      hermesHome,
      manifestDirectory
    })

    process.stdout.write(`${JSON.stringify({
      extensionDirectory: result.extensionDirectory,
      extensionId: result.extensionId,
      manifestPath: result.nativeHost.manifestPath,
      ready: false
    }, null, 2)}\n`)
    process.stderr.write(`Load unpacked extension: ${result.extensionDirectory}\n`)

    return
  }

  if (command === 'check') {
    const status = await checkChromeBridgeSetup({
      hermesHome,
      nativeManifestPath: manifestDirectory === undefined
        ? undefined
        : join(resolve(manifestDirectory), `${HOST_NAME}.json`)
    })

    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
    process.exitCode = status.ready ? 0 : 1

    return
  }

  throw new Error('usage: hermes-chrome-bridge-setup <install|check> [--hermes-home <path>]')
}

function isEntrypoint(): boolean {
  if (process.argv[1] === undefined) { return false }

  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntrypoint()) {
  await runCli()
}
