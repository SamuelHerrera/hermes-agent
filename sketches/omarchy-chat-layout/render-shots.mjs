import { chromium } from '@playwright/test'

const p = '/Users/samuelherrerafuente/.hermes/hermes-agent/sketches/omarchy-chat-layout'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1456, height: 883 }, deviceScaleFactor: 1 })
await page.goto(`file://${p}/index.html`)
const shots = [
  ['two', 'mockup-step-1-two-columns.png'],
  ['three', 'mockup-step-2-more-columns.png'],
  ['rows', 'mockup-step-3-rows.png'],
  ['matrix', 'mockup-step-4-matrix.png'],
  ['focus', 'mockup-step-5-focus-stack.png']
]
for (const [id, file] of shots) {
  if (id !== 'two') await page.click(`[data-pick="${id}"]`)
  await page.screenshot({ path: `${p}/${file}`, fullPage: false })
}
await b.close()
