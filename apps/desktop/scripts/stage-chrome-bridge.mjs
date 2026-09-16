#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const repoRoot = resolve(desktopRoot, '..', '..')
const stageRoot = join(desktopRoot, 'dist', 'chrome-bridge')
const packageRoot = join(repoRoot, 'packages', 'hermes-chrome-bridge')

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: process.env,
    stdio: 'inherit'
  })
}

async function main() {
  if (!existsSync(join(packageRoot, 'package.json'))) {
    throw new Error(`Chrome Bridge package not found: ${packageRoot}`)
  }

  run('npm', ['run', 'build', '--workspace', '@hermes/chrome-bridge'])

  const tempRoot = mkdtempSync(join(tmpdir(), 'hermes-chrome-bridge-stage-'))
  try {
    run('npm', ['pack', '--workspace', '@hermes/chrome-bridge', '--pack-destination', tempRoot])
    const tarballs = (await import('node:fs/promises')).readdir(tempRoot)
      .then(entries => entries.filter(name => name.endsWith('.tgz')))
    const tarballNames = await tarballs
    if (tarballNames.length !== 1) {
      throw new Error(`expected one Chrome Bridge tarball, found ${tarballNames.length}`)
    }

    const installRoot = join(tempRoot, 'install')
    await mkdir(installRoot, { recursive: true })
    await (await import('node:fs/promises')).writeFile(
      join(installRoot, 'package.json'),
      JSON.stringify({ private: true, dependencies: {} }, null, 2),
      'utf8'
    )
    run('npm', ['install', '--omit=dev', '--ignore-scripts', join(tempRoot, tarballNames[0])], {
      cwd: installRoot
    })

    rmSync(stageRoot, { force: true, recursive: true })
    await mkdir(stageRoot, { recursive: true })
    await cp(join(installRoot, 'node_modules'), join(stageRoot, 'node_modules'), { recursive: true })
    // npm creates absolute symlinks in node_modules/.bin. They point into the
    // temporary staging prefix, break electron-builder after cleanup, and are
    // unnecessary because Hermes invokes dist/server.js and dist/native/setup.js
    // directly.
    rmSync(join(stageRoot, 'node_modules', '.bin'), { force: true, recursive: true })

    const server = join(stageRoot, 'node_modules', '@hermes', 'chrome-bridge', 'dist', 'server.js')
    const setup = join(stageRoot, 'node_modules', '@hermes', 'chrome-bridge', 'dist', 'native', 'setup.js')
    const extension = join(stageRoot, 'node_modules', '@hermes', 'chrome-bridge', 'dist', 'extension', 'manifest.json')
    for (const required of [server, setup, extension]) {
      if (!existsSync(required)) {
        throw new Error(`staged Chrome Bridge artifact missing: ${required}`)
      }
    }

    console.log(`[stage-chrome-bridge] staged package at ${stageRoot}`)
  } finally {
    rmSync(tempRoot, { force: true, recursive: true })
  }
}

await main()
