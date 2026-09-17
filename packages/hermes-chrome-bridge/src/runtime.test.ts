import { chmod, mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { brokerSocketPathFor, isLocalBrokerSocketPath, readBrokerClientConfig, readRuntimeConfig, setPrivateWindowsPath, writePrivateJson } from './runtime.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async directory => {
    await rm(directory, { force: true, recursive: true })
  }))
})

describe('private runtime JSON writes', () => {
  it('builds a protected current-user ACL without interpolating paths into PowerShell', async () => {
    const path = "C:\\Owner's home\\secret'; Write-Output unsafe"
    let script = ''
    await setPrivateWindowsPath(path, true, async args => {
      expect(args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand', expect.any(String)])
      script = Buffer.from(args[3], 'base64').toString('utf16le')
    })
    expect(script).not.toContain(path)
    expect(script).toContain(Buffer.from(path, 'utf8').toString('base64'))
    expect(script).toContain('SetAccessRuleProtection($true, $false)')
    expect(script).toContain('WindowsIdentity]::GetCurrent().User')
    expect(script).toContain('DirectorySecurity')
  })

  it('uses local Windows named pipes with stable per-home identities', () => {
    const first = brokerSocketPathFor('C:\\Homes\\owner', 'win32')
    expect(first.startsWith('\\\\.\\pipe\\hermes-chrome-bridge-')).toBe(true)
    expect(first).toBe(brokerSocketPathFor('C:\\Homes\\owner', 'win32'))
    expect(first).not.toBe(brokerSocketPathFor('C:\\Homes\\client', 'win32'))
    expect(isLocalBrokerSocketPath(first, 'win32')).toBe(true)
    expect(isLocalBrokerSocketPath('\\\\.\\pipe\\hermes-chrome-bridge-invalid', 'win32')).toBe(false)
    expect(isLocalBrokerSocketPath('\\\\remote\\pipe\\hermes-chrome-bridge-' + 'a'.repeat(32), 'win32')).toBe(false)
  })

  it('loads only explicit private enrollment and keeps native credentials separate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hcb-enrollment-'))
    temporaryDirectories.push(directory)
    const clientPath = join(directory, 'broker-client.json')
    const config = { version: 1, clientId: 'work', socketPath: join(directory, 'broker.sock'), token: 'c'.repeat(64) }
    await writePrivateJson(clientPath, config)
    expect((await readBrokerClientConfig(clientPath)).clientId).toBe('work')
    await expect(readRuntimeConfig(clientPath)).rejects.toThrow('invalid')
    await chmod(clientPath, 0o644)
    await expect(readBrokerClientConfig(clientPath)).rejects.toThrow('private')
    await chmod(clientPath, 0o600)
    const link = join(directory, 'link.json')
    await symlink(clientPath, link)
    await expect(readBrokerClientConfig(link)).rejects.toThrow('private')
    const ownerPath = join(directory, 'owner.json')
    await writePrivateJson(ownerPath, { version: 1, origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/', socketPath: config.socketPath, statusPath: join(directory, 'status.json'), token: 'a'.repeat(64), clientTokens: { work: config.token } })
    expect(Object.keys((await readRuntimeConfig(ownerPath)).clientTokens ?? {})).toEqual(['work'])
    await expect(readBrokerClientConfig(ownerPath)).rejects.toThrow('invalid')
  })

  it('atomically handles repeated concurrent writes without temp collisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hermes-runtime-write-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'status.json')

    await Promise.all(Array.from({ length: 50 }, async (_, sequence) => {
      await writePrivateJson(path, { sequence })
    }))

    const parsed = JSON.parse(await readFile(path, 'utf8')) as { sequence: number }
    expect(parsed.sequence).toBeGreaterThanOrEqual(0)
    expect(parsed.sequence).toBeLessThan(50)
    expect(await readdir(directory)).toEqual(['status.json'])
  })
})
