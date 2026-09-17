import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { brokerSocketPathFor, ensurePrivateRuntimeDirectory, readRuntimeConfig, writePrivateJson } from '../src/runtime.js'
import { createDefaultRouter } from '../src/server.js'

import { enrollClient, revokeClient } from './enroll-client.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hcb-enrollment-'))
  roots.push(root)
  const ownerHome = join(root, 'owner')
  const owner = join(ownerHome, 'chrome-bridge')
  await ensurePrivateRuntimeDirectory(owner)
  await writePrivateJson(join(owner, 'config.json'), {
    version: 1, origin: `chrome-extension://${'a'.repeat(32)}/`, token: 'a'.repeat(64),
    socketPath: brokerSocketPathFor(ownerHome), statusPath: join(owner, 'status.json')
  })

  return { root, ownerHome, owner }
}

describe('explicit shared-broker enrollment', () => {
  it('runs enrolled homes through the real default-router/socket resolution chain', async () => {
    const { root, ownerHome } = await fixture()
    const clientHome = join(root, 'peer')
    await enrollClient({ ownerHome, clientHome, clientId: 'peer' })
    const owner = await createDefaultRouter({ hermesHome: ownerHome })

    try {
      const peer = await createDefaultRouter({ hermesHome: clientHome })
      await expect(peer.router.route({ method: 'status', arguments: {} })).resolves.toMatchObject({ connectionCount: 0 })
      await peer.close()
      await expect(owner.router.route({ method: 'status', arguments: {} })).resolves.toMatchObject({ connectionCount: 0 })
    } finally { await owner.close() }

    await expect(createDefaultRouter({ hermesHome: clientHome })).rejects.toThrow()
  })
  it('issues a separate scoped client credential without returning it or changing native ownership', async () => {
    const { root, ownerHome, owner } = await fixture()
    const clientHome = join(root, 'client')
    const result = await enrollClient({ ownerHome, clientHome, clientId: 'development' })
    expect(result).toEqual({ enrolled: true, ownerRestartRequired: true })
    const client = JSON.parse(await readFile(join(clientHome, 'chrome-bridge', 'broker-client.json'), 'utf8'))
    const config = await readRuntimeConfig(join(owner, 'config.json'))
    expect(client.token).not.toBe(config.token)
    expect(config.clientTokens?.development).toBe(client.token)
    expect(JSON.stringify(result)).not.toContain(client.token)
    expect(config.origin).toBe(`chrome-extension://${'a'.repeat(32)}/`)
    await expect(enrollClient({ ownerHome, clientHome: join(root, 'another'), clientId: 'development' })).rejects.toThrow('already enrolled')
    await revokeClient({ ownerHome, clientId: 'development' })
    expect((await readRuntimeConfig(join(owner, 'config.json'))).clientTokens?.development).toBeUndefined()
  })

  it('does not overwrite an existing owner or client configuration', async () => {
    const { root, ownerHome } = await fixture()
    await expect(enrollClient({ ownerHome, clientHome: ownerHome, clientId: 'self' })).rejects.toThrow()
    const clientHome = join(root, 'client')
    const client = join(clientHome, 'chrome-bridge')
    await ensurePrivateRuntimeDirectory(client)
    await writePrivateJson(join(client, 'config.json'), { sentinel: 'existing owner' })
    await expect(enrollClient({ ownerHome, clientHome, clientId: 'x' })).rejects.toThrow('already configured')
    expect(JSON.parse(await readFile(join(client, 'config.json'), 'utf8'))).toEqual({ sentinel: 'existing owner' })
  })
})
