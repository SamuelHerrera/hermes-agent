import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const BROWSER_ENTRY_SENTINEL = 'hermes-browser-bootstrap:v1'

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])(\.{1,2}\/[^"']+\.js)\1/g

async function readEntryGraph(entryPath, distRoot) {
  const pending = [entryPath]
  const visited = new Set()
  const sources = []

  while (pending.length > 0) {
    const current = pending.pop()
    const relative = path.relative(distRoot, current)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Browser dist entry graph escapes the distribution root: ${current}`)
    }
    if (visited.has(current)) {
      continue
    }
    visited.add(current)

    const source = await readFile(current, 'utf8')
    sources.push(source)
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      pending.push(path.resolve(path.dirname(current), match[2]))
    }
  }

  return sources
}

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
  const entryPath = path.join(distRoot, 'assets', match[1])
  const entryGraph = await readEntryGraph(entryPath, distRoot)
  if (!entryGraph.some((source) => source.includes(BROWSER_ENTRY_SENTINEL))) {
    throw new Error('Browser dist entry graph does not contain the browser bootstrap sentinel.')
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  const distRoot = path.resolve(import.meta.dirname, '../../../hermes_cli/desktop_web_dist')
  await assertBrowserDist(distRoot)
  console.log(`Browser Desktop bundle verified: ${distRoot}`)
}
