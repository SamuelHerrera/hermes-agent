import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function assertBrowserDist(distRoot) {
  const indexPath = path.join(distRoot, 'index.html')
  const html = await readFile(indexPath, 'utf8')
  if (/\/src\/main\.tsx/.test(html)) {
    throw new Error('Browser dist has no emitted browser entry; index still references /src/main.tsx.')
  }
  const match = html.match(/(?:src|href)=["'](?:\.\/|\/desktop\/)?assets\/([^"']+\.js)["']/)
  if (!match) throw new Error('Browser dist index does not reference an emitted browser entry asset.')
  const files = await readdir(path.join(distRoot, 'assets'))
  if (!files.includes(match[1])) throw new Error(`Browser dist entry asset is missing: ${match[1]}`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  const distRoot = path.resolve(import.meta.dirname, '../../../hermes_cli/desktop_web_dist')
  await assertBrowserDist(distRoot)
  console.log(`Browser Desktop bundle verified: ${distRoot}`)
}
