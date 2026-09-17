// Opt-in live smoke: launches ONLY disposable Chrome-for-Testing profiles.
// Run from the repo after building: node packages/hermes-chrome-bridge/scripts/multi-profile-smoke.mjs
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium } from 'playwright'

import { installNativeHost } from '../dist/native/install-host.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = await mkdtemp(join(tmpdir(), 'hcb-live-'))
const evidenceRoot = resolve(process.argv[2] ?? join(root, 'evidence'))
await mkdir(evidenceRoot, { recursive: true })
const home = join(root, 'hermes')
const browserHome = join(root, 'home')
// A test-only PUBLIC manifest key prevents accidental authorization by a real
// user's native host if Chrome ignores our isolated HOME. Extension code is unmodified.
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicDer = publicKey.export({ type: 'spki', format: 'der' })
const extensionId = [...createHash('sha256').update(publicDer).digest('hex').slice(0, 32)]
  .map(digit => String.fromCharCode(97 + parseInt(digit, 16))).join('')
const extensionPath = join(root, 'extension')
await cp(join(packageRoot, 'dist', 'extension'), extensionPath, { recursive: true })
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'))
manifest.key = publicDer.toString('base64')
await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest))
const contexts = []
const popups = []
const pages = []
const client = new Client({ name: 'two-profile-live-smoke', version: '1' })
const evidence = { browser: chromium.executablePath(), profiles: [], checks: [] }
let transport

async function call(method, args = {}, expectedError) {
  const response = await client.callTool({ name: `chrome_bridge_${method}`, arguments: args })
  const text = response.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  let result
  try { result = JSON.parse(text) } catch { result = { message: text } }
  if (expectedError) {
    assert.equal(response.isError, true, text)
    if (expectedError !== true) { assert.equal(result.code, expectedError, text) }
  } else { assert.notEqual(response.isError, true, text) }
  return result
}
async function waitFor(read, accept, message) {
  const deadline = Date.now() + 20_000
  do {
    const value = await read()
    if (accept(value)) { return value }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  } while (Date.now() < deadline)
  throw new Error(message)
}

try {
  // Register only in the disposable user-data dirs and disposable HOME.
  const installed = await installNativeHost({ builtHostPath: join(packageRoot, 'dist/native/host.js'),
    extensionId, hermesHome: home, userHome: browserHome })
  transport = new StdioClientTransport({ command: process.execPath,
    args: [join(packageRoot, 'dist/server.js'), '--hermes-home', home], stderr: 'pipe' })
  transport.stderr?.on('data', chunk => process.stderr.write(chunk))
  await client.connect(transport)
  evidence.tools = (await client.listTools()).tools.length
  assert.equal((await call('status')).connectionCount, 0)

  for (const label of ['Bridge Test A', 'Bridge Test B']) {
    const profile = join(root, label.replaceAll(' ', '-'))
    await mkdir(join(profile, 'NativeMessagingHosts'), { recursive: true })
    await copyFile(installed.manifestPath, join(profile, 'NativeMessagingHosts/com.nous.hermes_chrome_bridge.json'))
    const context = await chromium.launchPersistentContext(profile, {
      headless: false,
      env: { ...process.env, HOME: browserHome },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run'],
      viewport: { width: 1000, height: 760 }
    })
    contexts.push(context)
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    assert.ok(worker.url().startsWith(`chrome-extension://${extensionId}/`))
    const popup = await context.newPage()
    popups.push(popup)
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.locator('#profile-label').fill(label)
    // Real popup UI opt-in. Never write the opt-in storage key from a harness.
    await popup.getByRole('button', { name: 'Connect', exact: true }).click()
    await popup.locator('#status[data-state="connected"]').waitFor({ timeout: 20_000 })
    await popup.screenshot({ path: join(evidenceRoot, `popup-${contexts.length}.png`) })
    const status = await call('status')
    const identity = status.connections.find(connection => connection.label === label)
    assert.ok(identity, JSON.stringify(status))
    evidence.profiles.push(identity)
    const opened = await call('open', { connectionId: identity.connectionId, url: 'https://example.com/?token=smoke-only', active: false })
    const page = await waitFor(() => context.pages(), value => value.some(item => item.url().startsWith('https://example.com/')), 'opened page missing')
    const publicPage = page.find(item => item.url().startsWith('https://example.com/'))
    await publicPage.waitForLoadState('domcontentloaded')
    // Distinguishable, non-secret fixture content on a real public page.
    await publicPage.locator('h1').evaluate((heading, text) => { heading.textContent = text }, label)
    pages.push({ page: publicPage, tabId: opened.tabId, connectionId: identity.connectionId })
    evidence.version = context.browser()?.version()
  }

  const both = await call('status')
  assert.equal(both.connectionCount, 2)
  evidence.checks.push('two real profiles simultaneously authenticated')
  const results = await Promise.all(pages.map(({ tabId }) => call('query', { tabId, selector: 'h1' })))
  for (const [index, result] of results.entries()) { assert.ok(JSON.stringify(result).includes(evidence.profiles[index].label)) }
  assert.notEqual(pages[0].tabId, pages[1].tabId)
  evidence.tabIds = pages.map(item => item.tabId)
  evidence.checks.push('concurrent namespaced queries reach their own profile')
  await call('open', { url: 'https://example.com/' }, 'AMBIGUOUS_CONNECTION')
  await call('close', { tabId: pages[0].tabId, connectionId: pages[1].connectionId }, 'CONNECTION_MISMATCH')
  await call('eval', { tabId: pages[0].tabId, source: 'document.title', approvalIntent: 'explicit-user-approved-js-eval' }, true)
  evidence.checks.push('ambiguous open, mismatched connection and unapproved eval fail closed')
  for (const { tabId, connectionId } of pages) {
    await call('select_tab', { tabId })
    const tabs = await call('tabs', { connectionId })
    assert.equal(tabs.selectedTabId, tabId)
    assert.ok(tabs.tabs.every(tab => !tab.url.includes('smoke-only')))
  }
  evidence.checks.push('selected tabs isolated; URL credentials redacted')
  await popups[0].getByRole('button', { name: 'Disconnect', exact: true }).click()
  await waitFor(() => call('status'), value => value.connectionCount === 1, 'disconnect not observed')
  await call('query', { tabId: pages[0].tabId, selector: 'h1' }, 'BRIDGE_DISCONNECTED')
  assert.ok(JSON.stringify(await call('query', { tabId: pages[1].tabId, selector: 'h1' })).includes('Bridge Test B'))
  await popups[0].getByRole('button', { name: 'Connect', exact: true }).click()
  await waitFor(() => call('status'), value => value.connectionCount === 2, 'reconnect not observed')
  const reconnected = await call('status')
  assert.ok(reconnected.connections.some(item => item.connectionId === pages[0].connectionId))
  await call('query', { tabId: pages[0].tabId, selector: 'h1' }, 'STALE_TAB_ID')
  const fresh = await call('tabs', { connectionId: pages[0].connectionId })
  const freshTabId = fresh.tabs.find(tab => tab.url.startsWith('https://example.com/')).tabId
  assert.ok(JSON.stringify(await call('query', { tabId: freshTabId, selector: 'h1' })).includes('Bridge Test A'))
  assert.ok(JSON.stringify(await call('query', { tabId: pages[1].tabId, selector: 'h1' })).includes('Bridge Test B'))
  evidence.checks.push('independent Disconnect/reconnect preserves identity, rejects stale tab IDs, leaves peer controllable')
  const screenshot = await call('screenshot', { tabId: pages[1].tabId })
  assert.ok(screenshot.bytes > 0)
  await writeFile(join(evidenceRoot, 'profile-b-page.png'), Buffer.from(screenshot.dataUrl.split(',')[1], 'base64'))
  evidence.checks.push('real MCP screenshot captured through native host and extension')
  evidence.success = true
} catch (error) {
  evidence.success = false
  evidence.error = String(error)
  for (const [index, popup] of popups.entries()) {
    evidence[`popup${index}`] = await popup.locator('body').innerText().catch(() => 'unavailable')
  }
  process.exitCode = 1
} finally {
  for (const popup of popups) {
    await popup.getByRole('button', { name: 'Disconnect', exact: true }).click({ timeout: 1000 }).catch(() => undefined)
  }
  await Promise.all(contexts.map(context => context.close()))
  await client.close().catch(() => undefined)
  await writeFile(join(evidenceRoot, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ ...evidence, evidenceRoot }, null, 2))
  if (!evidenceRoot.startsWith(root + '/')) { await rm(root, { force: true, recursive: true }) }
}
