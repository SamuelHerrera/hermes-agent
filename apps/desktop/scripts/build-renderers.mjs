import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertBrowserDist } from './assert-browser-dist.mjs'

const viteBin = path.resolve(import.meta.dirname, '../../../node_modules/vite/bin/vite.js')
const browserDist = path.resolve(import.meta.dirname, '../../../hermes_cli/desktop_web_dist')

function runVite(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin, ...args], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Vite ${args.join(' ')} failed (${signal ?? `exit ${code}`}).`))
    })
  })
}

export async function buildRenderers({ run = runVite, assertBrowserBundle = () => assertBrowserDist(browserDist) } = {}) {
  await run(['build'])
  await run(['build', '--mode', 'browser'])
  await assertBrowserBundle()
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  await buildRenderers()
  console.log(`Electron and browser renderer bundles built; browser bundle verified: ${browserDist}`)
}