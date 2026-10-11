// Private stdio helper: never listens on a network port or loads a user profile.
import { chromium } from 'playwright'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { once } from 'node:events'

let browser
let closing = false
const send = async value => {
  if (!process.stdout.write(`${JSON.stringify(value)}\n`)) await once(process.stdout, 'drain')
}
const safeUrl = url => {
  if (url === 'about:blank') return true
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
  } catch { return false }
}
async function close() {
  if (closing) return
  closing = true
  try { await browser?.close() } finally { process.exit(0) }
}
process.on('SIGTERM', close)
process.on('SIGINT', close)
process.stdout.on('error', close)
try {
  // Playwright otherwise disables Chromium's sandbox by default. Explicitly
  // enable it; root/unsupported kernel fails closed, never --no-sandbox.
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {})
  })
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: false, serviceWorkers: 'block' })
  await context.route('**/*', route => safeUrl(route.request().url()) ? route.continue() : route.abort())
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.setDefaultNavigationTimeout(15000)
  const cdp = await context.newCDPSession(page)
  page.on('dialog', dialog => { void dialog.dismiss() })
  context.on('page', popup => {
    if (popup === page) return
    // Bound page count, retain link target inside the owned viewport.
    popup.on('framenavigated', frame => {
      if (frame === popup.mainFrame() && safeUrl(frame.url()) && frame.url() !== 'about:blank') {
        void page.goto(frame.url(), { waitUntil: 'domcontentloaded' }).catch(() => {})
      }
      void popup.close().catch(() => {})
    })
    setTimeout(() => { void popup.close().catch(() => {}) }, 1000).unref()
  })
  let awaitingAck = false
  let capturing = false
  async function frame() {
    if (closing || capturing || awaitingAck) return
    capturing = true
    try {
      if (!safeUrl(page.url())) {
        await page.goto('about:blank')
        await send({ type: 'error', error: 'Only HTTP(S) pages are allowed' })
      }
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 70, timeout: 5000 })
      awaitingAck = true
      await send({ type: 'frame', image: jpeg.toString('base64'), url: page.url(), title: await page.title(), ...page.viewportSize() })
    } catch { /* Navigation can invalidate a capture. Retry on next interval. */ }
    finally { capturing = false }
  }
  const timer = setInterval(() => { void frame() }, 250)
  timer.unref()
  await send({ type: 'ready', protocol: 1 })
  await frame()
  const input = createInterface({ input: process.stdin })
  // ACK and stop bypass a pending slow navigation, so streaming/backpressure
  // and the Stop button keep working during network waits.
  input.on('line', line => {
    try {
      const command = JSON.parse(line)
      if (command.type === 'ack') awaitingAck = false
      if (command.type === 'stop') void cdp.send('Page.stopLoading').catch(() => {})
    } catch {}
  })
  for await (const line of input) {
    let command
    let actionFailed = false
    try {
      command = JSON.parse(line)
      switch (command.type) {
        case 'ack': awaitingAck = false; break
        case 'navigate':
          if (!safeUrl(command.url)) throw new Error('Invalid URL')
          await page.goto(command.url, { waitUntil: 'domcontentloaded' }); break
        case 'back': await page.goBack({ waitUntil: 'domcontentloaded' }); break
        case 'forward': await page.goForward({ waitUntil: 'domcontentloaded' }); break
        case 'reload': await page.reload({ waitUntil: 'domcontentloaded' }); break
        case 'stop': await cdp.send('Page.stopLoading'); break
        case 'resize': await page.setViewportSize({ width: command.width, height: command.height }); break
        case 'click': await page.mouse.click(command.x, command.y, { button: command.button }); break
        case 'scroll': await page.mouse.wheel(command.deltaX, command.deltaY); break
        case 'type': await page.keyboard.insertText(command.text); break
        case 'key': await page.keyboard.press(command.key); break
        default: throw new Error('Invalid command')
      }
    } catch {
      actionFailed = true
      await send({ type: 'error', error: 'Browser action failed (page unreachable or unsupported input)' })
    }
    // Navigation/loading completion is explicit even when the page is static.
    if (command?.type !== 'ack' && !actionFailed) await send({ type: 'state', url: safeUrl(page.url()) ? page.url() : 'about:blank', title: await page.title().catch(() => ''), loading: false })
  }
  await close()
} catch {
  await send({ type: 'unavailable' }).catch(() => {})
  await close()
}
