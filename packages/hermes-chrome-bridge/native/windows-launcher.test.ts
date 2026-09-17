import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { expect, it } from 'vitest'

import { buildWindowsLauncher, registerWindowsHost } from './windows-launcher.js'

const exec = promisify(execFile)
const goPath = existsSync('/opt/homebrew/bin/go') ? '/opt/homebrew/bin/go' : 'go'

it('cross-builds a genuine Windows executable without a command-shell launcher', async context => {
  try { await exec(goPath, ['version']) } catch { context.skip('Go compiler is unavailable');

 return }

  const directory = await mkdtemp(join(tmpdir(), 'hcb-pe-'))

  try {
    const path = join(directory, 'native-host.exe')
    await buildWindowsLauncher({ outputPath: path, goPath })
    const bytes = await readFile(path)
    expect(bytes.subarray(0, 2).toString()).toBe('MZ')
    const pe = bytes.readUInt32LE(0x3c)
    expect(bytes.subarray(pe, pe + 4).toString()).toBe('PE\u0000\u0000')
    expect(bytes.readUInt16LE(pe + 4)).toBe(0x8664)

    if (process.platform !== 'win32') { expect((await exec('file', [path])).stdout).toContain('PE32+') }
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 120_000)

it('registers HKCU Chrome native messaging with an argument vector and refuses other owners', async () => {
  const calls: string[][] = []

  const run = async (args: string[]): Promise<string> => {
    calls.push(args)

    if (args[0] === 'query') { throw Object.assign(new Error('missing'), { code: 1 }) }

    return ''
  }

  await registerWindowsHost('C:\\Private Home\\host.json', run)
  expect(calls[1]).toEqual(['add', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.nous.hermes_chrome_bridge', '/ve', '/t', 'REG_SZ', '/d', 'C:\\Private Home\\host.json', '/f'])
  await expect(registerWindowsHost('C:\\new\\host.json', async () => '    (Default)    REG_SZ    C:\\owner\\host.json\r\n')).rejects.toThrow('already registered')
})
