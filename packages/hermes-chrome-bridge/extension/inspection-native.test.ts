import { build } from 'esbuild'
import { type Browser, chromium, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'

let browser: Browser
let page: Page
let source: string
beforeAll(async () => {
  source = (await build({ entryPoints: ['extension/page-inspector.ts'], bundle: true, write: false, format: 'iife', globalName: 'Inspection' })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
})
afterAll(async () => { await browser?.close() })

async function fixture(html: string) {
  await page.setContent(html)
  await page.addScriptTag({ content: source })
  await page.evaluate<any>('window.inspector = Inspection.createPageInspector(document)')
}

it('paginates with opaque option/document-bound cursors and field projection', async () => {
  await fixture(Array.from({length: 90}, (_, i) => `<button>Button ${i}</button>`).join(''))
  const first = await page.evaluate<any>('inspector.snapshot({format:"both",limit:2,fields:["ref","name"],maxChars:5})')
  expect(first.elements).toHaveLength(2)
  expect(Object.keys(first.elements[0]).sort()).toEqual(['name','ref'])
  expect(first.elements[0].name.length).toBeLessThanOrEqual(5)
  expect(first.nextCursor).toEqual(expect.any(String))
  const next = await page.evaluate<any>(cursor => (window as any).inspector.snapshot({format:'both',limit:2,fields:['ref','name'],maxChars:5,cursor}), first.nextCursor)
  expect(next.elements[0].ref).not.toBe(first.elements[0].ref)
  await expect(page.evaluate<any>(cursor => (window as any).inspector.snapshot({format:'both',limit:3,cursor}), first.nextCursor)).rejects.toThrow(/cursor/i)
  await page.evaluate<any>('document.querySelector("button").remove()')
  await expect(page.evaluate<any>(cursor => (window as any).inspector.snapshot({format:'both',limit:2,fields:['ref','name'],maxChars:5,cursor}), first.nextCursor)).rejects.toThrow(/cursor/i)
  expect((await page.evaluate<any>('inspector.snapshot({format:"both"})')).count).toBe(60)
  expect((await page.evaluate<any>('inspector.query({})')).count).toBe(20)
})
it('traverses shadow roots and frames, rejects replaced refs and reports inaccessible frames', async () => {
  await fixture('<div id="host"></div><iframe id="frame"></iframe><iframe sandbox srcdoc="<button>Private</button>"></iframe>')
  await page.evaluate<any>(() => {
    document.querySelector('#host')!.attachShadow({mode:'open'}).innerHTML = '<button>Shadow</button>'
    document.querySelector('iframe')!.contentDocument!.body.innerHTML = '<button>Frame</button>'
  })
  const result = await page.evaluate<any>('inspector.query({selector:"button"})')
  expect(result.elements.map((e: any) => e.name)).toEqual(['Shadow','Frame'])
  expect(result.inaccessibleFrames).toHaveLength(1)
  const ref = result.elements[1].ref
  expect(await page.evaluate<any>(r => (window as any).inspector.resolve(r).element.textContent, ref)).toBe('Frame')
  await page.evaluate<any>('document.querySelector("iframe").remove()')
  await expect(page.evaluate<any>(r => (window as any).inspector.resolve(r), ref)).rejects.toThrow(/stale/i)
  const shadowRef = result.elements[0].ref
  await page.evaluate<any>('document.querySelector("#host").shadowRoot.innerHTML = "<button>Replacement</button>"')
  await expect(page.evaluate<any>(r => (window as any).inspector.resolve(r), shadowRef)).rejects.toThrow(/stale/i)
})
it('resolves frame and shadow refs to exact document locators without values', async () => {
  await fixture('<div id="host"></div><iframe></iframe>')
  await page.evaluate<any>(() => {
    document.querySelector('#host')!.attachShadow({mode:'open'}).innerHTML = '<input id="field">'
    document.querySelector('iframe')!.contentDocument!.body.innerHTML = '<input id="field">'
  })
  const items = await page.evaluate<any>('inspector.query({selector:"#field"}).elements')

  for (const item of items) {
    const locator = await page.evaluate<any>(ref => (window as any).inspector.locate(ref), item.ref)
    expect(locator.locator.steps.at(-1).kind).toBe('element')
    expect(locator.sensitive).toBe(false)
    expect(locator.editable).toBe(true)
    expect(JSON.stringify(locator)).not.toContain('value')
  }
})
it('does not expose script labels or sensitive editable descendants through ancestor text', async () => {
  await fixture('<script id="label" type="application/json">SCRIPT_LABEL_CANARY</script><button aria-labelledby="label">Safe<span contenteditable="true" aria-label="password">EDIT_CANARY</span><span>Nested label</span></button>')
  const result = await page.evaluate<any>('inspector.snapshot({format:"both"})')
  expect(JSON.stringify(result)).not.toMatch(/CANARY/)
  expect(result.elements.filter((e: any) => e.text === 'Nested label')).toHaveLength(0)
})
it('bounds work per snapshot and resumes a large document without omissions', async () => {
  await fixture(Array.from({length: 4100}, (_, i) => `<button>B${i}</button>`).join(''))

  const result = await page.evaluate<any>(() => {
    const get = window.getComputedStyle.bind(window)
    let reads = 0

    window.getComputedStyle = (...args) => { reads++;

 return get(...args) }

    const inspector = (window as any).inspector
    let page = inspector.snapshot({format:'both',limit:500,fields:['ref']})
    const firstReads = reads
    const refs = page.elements.map((e: any) => e.ref)

    while (page.nextCursor) {
      page = inspector.snapshot({format:'both',limit:500,fields:['ref'],cursor:page.nextCursor})
      refs.push(...page.elements.map((e: any) => e.ref))
    }

    window.getComputedStyle = get

    return {firstReads,count:refs.length,unique:new Set(refs).size}
  })

  expect(result.firstReads).toBeLessThan(15000)
  expect(result.count).toBe(4100)
  expect(result.unique).toBe(4100)
})
it('keeps continuation valid across its own overlay updates', async () => {
  await fixture('<button>One</button><button>Two</button>')
  const first = await page.evaluate<any>('inspector.snapshot({format:"both",limit:1})')
  await page.evaluate<any>(() => {
    const overlay = document.createElement('div')
    overlay.setAttribute('data-hermes-chrome-control','true')
    document.body.append(overlay)
    overlay.style.left = '10px'
  })
  const second = await page.evaluate<any>(cursor => (window as any).inspector.snapshot({format:'both',limit:1,cursor}), first.nextCursor)
  expect(second.elements[0].name).toBe('Two')
})
it('reinjects the real content bundle without duplicate native handlers', async () => {
  await page.setContent('<button>Ready</button>')
  await page.evaluate<any>(() => {
    const listeners = new Set<any>()
    listeners.add((message: any, _sender: any, reply: any) => { if (message.version === 1) { reply({legacy:true}) } })

    ;(window as any).listeners = listeners
    ;(window as any).chrome = { runtime: { id: 'test-extension', onMessage: {
      addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn), hasListener: (fn: any) => listeners.has(fn)
    } } }
  })
  const bundle = (await build({entryPoints:['extension/content-script.ts'],bundle:true,write:false,format:'iife'})).outputFiles[0]!.text
  await page.addScriptTag({content:bundle})
  await page.addScriptTag({content:bundle})

  const result = await page.evaluate<any>(() => {
    const responses: unknown[] = []

    for (const listener of (window as any).listeners) {
      listener({type:'hermes.bridge.ping',version:2},{id:'test-extension'},(response: unknown) => responses.push(response))
    }

    return responses
  })

  expect(result).toEqual([{type:'hermes.bridge.pong',version:1,installationVersion:'inspection-2'}])
})
it('native compact inspection excludes hidden/script descendants and repeated ancestor text', async () => {
  await fixture(`<main><div><p>Visible prose</p></div><button>Go<span hidden>HIDDEN_CANARY</span><script type="application/json">SCRIPT_CANARY</script></button><style>STYLE_CANARY</style><div style="display:none"><button>INVISIBLE</button></div><p>${'Long '.repeat(90)}</p></main>`)
  const result = await page.evaluate<any>('inspector.snapshot({format:"both"})')
  expect(result.elements[0].role).toBe('button')
  expect(JSON.stringify(result)).not.toMatch(/CANARY|INVISIBLE/)
  expect(result.elements.filter((e: { text?: string }) => e.text === 'Visible prose')).toHaveLength(1)
  expect(result.elements.every((e: { name?: string, text?: string }) => (e.name?.length ?? 0) <= 100 && (e.text?.length ?? 0) <= 100)).toBe(true)
})
