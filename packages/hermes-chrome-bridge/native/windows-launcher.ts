import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { HOST_NAME } from './manifest.js'

const exec = promisify(execFile)
const REGISTRY_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`

// Embedded so npm's existing dist-only packaging contains the build source.
// Chrome launches this PE directly. No cmd.exe, shell interpolation or stdout logs.
const LAUNCHER_SOURCE = `package main
import (
 "encoding/json"
 "fmt"
 "os"
 "os/exec"
 "path/filepath"
)
type Config struct { NodePath string; HostPath string; ConfigPath string }
func fail() { fmt.Fprintln(os.Stderr, "Hermes native executable launcher failed"); os.Exit(1) }
func main() {
 executable, err := os.Executable(); if err != nil { fail() }
 data, err := os.ReadFile(executable + ".json"); if err != nil { fail() }
 var config Config
 if json.Unmarshal(data, &config) != nil { fail() }
 if !filepath.IsAbs(config.NodePath) || !filepath.IsAbs(config.HostPath) || !filepath.IsAbs(config.ConfigPath) { fail() }
 arguments := append([]string{config.HostPath, config.ConfigPath}, os.Args[1:]...)
 child := exec.Command(config.NodePath, arguments...)
 child.Stdin = os.Stdin; child.Stdout = os.Stdout; child.Stderr = os.Stderr
 if err := child.Run(); err != nil {
  if status, ok := err.(*exec.ExitError); ok { os.Exit(status.ExitCode()) }
  fail()
 }
}
`

export async function buildWindowsLauncher(options: {
  outputPath: string
  goPath?: string
  architecture?: 'amd64' | 'arm64'
}): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hermes-launcher-build-'))
  const output = join(directory, 'native-host.exe')

  try {
    const source = join(directory, 'main.go')
    await writeFile(source, LAUNCHER_SOURCE, { mode: 0o600 })

    try {
      await exec(options.goPath ?? 'go', ['build', '-trimpath', '-ldflags=-s -w', '-o', output, source], {
        env: { ...process.env, GOOS: 'windows', GOARCH: options.architecture ?? 'amd64', CGO_ENABLED: '0', GOTOOLCHAIN: 'local' },
        timeout: 120_000
      })
    } catch {
      throw new Error('Windows native host requires Go on PATH to build its PE launcher; no shell-script fallback is supported')
    }

    await verifyWindowsLauncher(output)
    // Destination may be on a different filesystem from the build temp directory.
    const temporary = `${options.outputPath}.${process.pid}.tmp`

    try {
      await writeFile(temporary, await readFile(output), { mode: 0o700, flag: 'wx' })
      await rename(temporary, options.outputPath)
    } finally { await rm(temporary, { force: true }) }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

export async function verifyWindowsLauncher(path: string): Promise<void> {
  const bytes = await readFile(path)

  if (bytes.length < 64 || bytes.subarray(0, 2).toString() !== 'MZ') { throw new Error('native launcher is not a Windows PE executable') }
  const offset = bytes.readUInt32LE(0x3c)

  if (offset + 6 > bytes.length || bytes.subarray(offset, offset + 4).toString() !== 'PE\u0000\u0000' ||
      ![0x8664, 0xaa64].includes(bytes.readUInt16LE(offset + 4))) {
    throw new Error('native launcher is not a supported Windows PE executable')
  }
}

export async function registerWindowsHost(
  manifestPath: string,
  run: (args: string[]) => Promise<string> = async args => (await exec('reg.exe', args, { windowsHide: true })).stdout
): Promise<void> {
  let existing: string | undefined

  try {
    const output = await run(['query', REGISTRY_KEY, '/ve'])
    existing = /REG_SZ\s+([^\r\n]+)/.exec(output)?.[1]?.trim()

    if (existing === undefined) { throw new Error('could not inspect existing native host registry value') }
  } catch (error) {
    if ((error as { code?: unknown }).code !== 1) { throw error }
  }

  if (existing !== undefined && existing.toLowerCase() !== manifestPath.toLowerCase()) {
    throw new Error('native host already registered to another Hermes home; explicitly enroll a shared broker client instead')
  }

  await run(['add', REGISTRY_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'])
}
