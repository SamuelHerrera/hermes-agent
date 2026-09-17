#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { chmod, mkdir, readFile, rmdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  brokerSocketPathFor,
  ensurePrivateRuntimeDirectory,
  readRuntimeConfig,
  resolveHermesHome,
  runtimeDirectoryFor,
  writePrivateJson
} from '../src/runtime.js'

import {
  buildNativeHostManifest,
  HOST_NAME,
  nativeManifestPath,
  originFromExtensionId,
  PROTOCOL_VERSION
} from './manifest.js'
import { buildWindowsLauncher, registerWindowsHost } from './windows-launcher.js'

export interface InstallNativeHostOptions {
  goPath?: string
  builtHostPath: string
  extensionId: string
  hermesHome?: string
  manifestDirectory?: string
  nodePath?: string
  platform?: NodeJS.Platform
  userHome?: string
}

export interface InstallNativeHostResult {
  configPath: string
  manifestPath: string
  runtimeDirectory: string
  statusPath: string
  wrapperPath: string
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export async function installNativeHost(
  options: InstallNativeHostOptions
): Promise<InstallNativeHostResult> {
  const platform = options.platform ?? process.platform

  const hermesHome = resolveHermesHome(options.hermesHome)
  const runtimeDirectory = runtimeDirectoryFor(hermesHome)
  const configPath = join(runtimeDirectory, 'config.json')
  const statusPath = join(runtimeDirectory, 'status.json')
  const socketPath = brokerSocketPathFor(hermesHome, platform)
  const wrapperPath = join(runtimeDirectory, platform === 'win32' ? 'native-host.exe' : 'native-host')
  const builtHostPath = resolve(options.builtHostPath)
  const nodePath = resolve(options.nodePath ?? process.execPath)
  const origin = originFromExtensionId(options.extensionId)

  if (!isAbsolute(builtHostPath) || !isAbsolute(nodePath)) {
    throw new Error('native host executable paths must be absolute')
  }

  const defaultManifestPath = nativeManifestPath(options.userHome ?? homedir(), platform)

  const manifestPath = options.manifestDirectory === undefined
    ? defaultManifestPath
    : join(resolve(options.manifestDirectory), `${HOST_NAME}.json`)

  await mkdir(dirname(manifestPath), { recursive: true })
  const lockPath = `${manifestPath}.install-lock`

  try { await mkdir(lockPath, { mode: 0o700 }) } catch {
    throw new Error('native host registration is locked by another installer; retry after it finishes')
  }

  try {
    try {
      const existing = JSON.parse(await readFile(manifestPath, 'utf8')) as { path?: unknown }

      if (existing.path !== wrapperPath) {
        throw new Error('native host already registered to another Hermes home; explicitly enroll a shared broker client instead')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error }
    }

    let configured = false

    try {
      const existing = await readRuntimeConfig(configPath)

      if (existing.origin !== origin || existing.socketPath !== socketPath) {
        throw new Error('existing native host configuration differs; explicit removal is required')
      }

      configured = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error }
    }

    await ensurePrivateRuntimeDirectory(runtimeDirectory)

    if (!configured) {
      await writePrivateJson(configPath, {
        origin,
        socketPath,
        statusPath,
        token: randomBytes(32).toString('hex'),
        version: PROTOCOL_VERSION
      })
      await writePrivateJson(statusPath, {
        connected: false,
        updatedAt: new Date().toISOString(),
        version: PROTOCOL_VERSION
      })

    }

    const wrapper = [
      '#!/bin/sh',
      `exec ${shellQuote(nodePath)} ${shellQuote(builtHostPath)} ${shellQuote(configPath)} "$@"`,
      ''
    ].join('\n')

    if (platform === 'win32') {
      await buildWindowsLauncher({ outputPath: wrapperPath, goPath: options.goPath,
        architecture: process.arch === 'arm64' && process.platform === 'win32' ? 'arm64' : 'amd64' })
      await writePrivateJson(`${wrapperPath}.json`, { NodePath: nodePath, HostPath: builtHostPath, ConfigPath: configPath })
    } else {
      await writeFile(wrapperPath, wrapper, { mode: 0o700 })
      await chmod(wrapperPath, 0o700)
    }

    await writePrivateJson(manifestPath, buildNativeHostManifest(wrapperPath, origin))

    if (platform === 'win32') { await registerWindowsHost(manifestPath) }

    return { configPath, manifestPath, runtimeDirectory, statusPath, wrapperPath }
  } finally { await rmdir(lockPath) }
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)

  return index === -1 ? undefined : args[index + 1]
}

export function parseInstallerArgs(args: string[]): Pick<
InstallNativeHostOptions,
'extensionId' | 'hermesHome' | 'manifestDirectory'
> {
  const extensionId = valueAfter(args, '--extension-id')

  if (extensionId === undefined) {
    throw new Error(
      'usage: install-host --extension-id <id> [--hermes-home <path>] [--manifest-directory <path>]'
    )
  }

  return {
    extensionId,
    hermesHome: valueAfter(args, '--hermes-home'),
    manifestDirectory: valueAfter(args, '--manifest-directory')
  }
}

async function runCli(): Promise<void> {
  const cliOptions = parseInstallerArgs(process.argv.slice(2))

  const result = await installNativeHost({
    builtHostPath: fileURLToPath(new URL('./host.js', import.meta.url)),
    ...cliOptions
  })

  process.stderr.write(`Installed ${HOST_NAME} manifest at ${result.manifestPath}\n`)
}

function isEntrypoint(): boolean {
  if (process.argv[1] === undefined) {
    return false
  }

  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntrypoint()) {
  await runCli()
}
