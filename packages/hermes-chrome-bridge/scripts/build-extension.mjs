import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceDirectory = join(packageDirectory, 'extension')
const outputDirectory = join(packageDirectory, 'dist', 'extension')

await rm(outputDirectory, { force: true, recursive: true })
await mkdir(outputDirectory, { recursive: true })

await build({
  bundle: true,
  charset: 'utf8',
  entryNames: '[name]',
  entryPoints: {
    background: join(sourceDirectory, 'background.ts'),
    'content-script': join(sourceDirectory, 'content-script.ts'),
    'main-world': join(sourceDirectory, 'main-world.ts'),
    popup: join(sourceDirectory, 'popup.ts')
  },
  format: 'esm',
  legalComments: 'none',
  logLevel: 'silent',
  outdir: outputDirectory,
  platform: 'browser',
  sourcemap: false,
  target: 'chrome120'
})

const manifest = JSON.parse(await readFile(join(sourceDirectory, 'manifest.json'), 'utf8'))
await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await Promise.all(['popup.css', 'popup.html'].map(async file => {
  await cp(join(sourceDirectory, file), join(outputDirectory, file))
}))
