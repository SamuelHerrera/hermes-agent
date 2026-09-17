#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { access, mkdir, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensurePrivateRuntimeDirectory, readRuntimeConfig, runtimeDirectoryFor, writePrivateJson } from '../src/runtime.js'

interface EnrollmentOptions { ownerHome: string, clientHome: string, clientId: string }

function checkId(clientId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(clientId)) { throw new Error('Client ID must be 1–64 letters, digits, underscores or hyphens.') }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path);

 return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return false }
    throw error
  }
}

/** Explicit operator command only; no automatic discovery or credential copying. */
export async function enrollClient({ ownerHome, clientHome, clientId }: EnrollmentOptions) {
  checkId(clientId)
  const owner = runtimeDirectoryFor(ownerHome)
  const recipient = runtimeDirectoryFor(clientHome)

  if (owner === recipient) { throw new Error('Owner and client homes must differ.') }
  // Read before creating anything: enrolling must never bootstrap an accidental owner.
  const configPath = join(owner, 'config.json')
  await readRuntimeConfig(configPath)
  await ensurePrivateRuntimeDirectory(recipient)
  const locks: string[] = []
  const clientPath = join(recipient, 'broker-client.json')

  try {
    for (const directory of [owner, recipient]) {
      const lock = join(directory, 'enrollment.lock')
      await mkdir(lock, { mode: 0o700 })
      locks.push(lock)
    }

    const config = await readRuntimeConfig(configPath)

    if (config.clientTokens?.[clientId] !== undefined) { throw new Error('Client ID is already enrolled.') }

    if (await exists(clientPath) || await exists(join(recipient, 'config.json'))) {
      throw new Error('Client home is already configured; explicitly remove its prior bridge configuration first.')
    }

    const token = randomBytes(32).toString('hex')
    await writePrivateJson(clientPath, { clientId, socketPath: config.socketPath, token, version: 1 })

    try {
      await writePrivateJson(configPath, { ...config, clientTokens: { ...config.clientTokens, [clientId]: token } })
    } catch (error) {
      await unlink(clientPath)
      throw error
    }

    return { enrolled: true as const, ownerRestartRequired: true as const }
  } finally {
    for (const lock of locks.reverse()) { await rmdir(lock) }
  }
}

export async function revokeClient({ ownerHome, clientId }: Pick<EnrollmentOptions, 'ownerHome' | 'clientId'>) {
  checkId(clientId)
  const owner = runtimeDirectoryFor(ownerHome)
  const lock = join(owner, 'enrollment.lock')
  await mkdir(lock, { mode: 0o700 })

  try {
    const path = join(owner, 'config.json')
    const config = await readRuntimeConfig(path)
    const clientTokens = { ...config.clientTokens }
    delete clientTokens[clientId]
    await writePrivateJson(path, { ...config, clientTokens })

    return { revoked: true as const, ownerRestartRequired: true as const }
  } finally { await rmdir(lock) }
}

async function main(args: string[]): Promise<void> {
  const options: Record<string, string> = {}

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]

    if (!flag || !['--owner-home', '--client-home', '--client-id', '--revoke'].includes(flag) ||
      !value || value.startsWith('--') || flag in options) { throw new Error('Invalid enrollment arguments.') }

    options[flag] = value
  }

  const ownerHome = options['--owner-home']

  if (!ownerHome) { throw new Error('Specify --owner-home and --client-home --client-id, or --revoke <client-id>.') }

  if (options['--revoke']) {
    if (options['--client-home'] || options['--client-id']) { throw new Error('Do not mix enrollment and revocation arguments.') }
    console.log(JSON.stringify(await revokeClient({ ownerHome, clientId: options['--revoke'] })))
  } else {
    const clientHome = options['--client-home'], clientId = options['--client-id']

    if (!clientHome || !clientId) { throw new Error('Specify --client-home and --client-id.') }
    console.log(JSON.stringify(await enrollClient({ ownerHome, clientHome, clientId })))
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).catch(() => {
    process.stderr.write('Enrollment failed; check home paths, client ID, existing ownership and enrollment locks. No credentials were printed.\n')
    process.exitCode = 1
  })
}
