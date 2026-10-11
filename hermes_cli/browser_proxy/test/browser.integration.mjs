// Explicit integration lane only. Launches a disposable TEST browser, never
// a backend runtime browser. Requires installed Playwright Chromium.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import https from 'node:https'
import http from 'node:http'
import net from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { createProxy } from '../server.mjs'

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const close = server =>
  new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  })

for (const mode of ['isolated', 'cached', 'same-origin']) {
  const cachedParent = mode === 'cached'
  const sameOrigin = mode === 'same-origin'
  test(
    `real proxy render/media/navigation: ${mode}`,
    { timeout: 120_000 },
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'hermes-proxy-test-'))
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          path.join(dir, 'key.pem'),
          '-out',
          path.join(dir, 'cert.pem'),
          '-days',
          '1',
          '-subj',
          '/CN=proxy.example.net'
        ],
        { stdio: 'ignore' }
      )
      const tls = { key: await readFile(path.join(dir, 'key.pem')), cert: await readFile(path.join(dir, 'cert.pem')) }
      const edge = https.createServer(tls)
      const edgePort = await listen(edge)
      const proxyOrigin = `https://proxy.example.net:${edgePort}`
      const helper = await createProxy({
        origin: proxyOrigin,
        port: 0,
        testOnly: true,
        allowSameOrigin: sameOrigin,
        deniedHosts: ['parent.example.org']
      })
      const tunnelSockets = new Set()
      // Exact production reverse-proxy semantics: preserve Host and Origin.
      edge.on('request', (req, res) => {
        if (sameOrigin && req.url === '/desktop/') return parentHandler(req, res)
        const upstream = http.request(
          { host: '127.0.0.1', port: helper.port, path: req.url, method: req.method, headers: req.headers },
          incoming => {
            // Force the cookie-blocked path, irrespective of Chromium's CHIPS support.
            delete incoming.headers['set-cookie']
            res.writeHead(incoming.statusCode, incoming.headers)
            incoming.pipe(res)
          }
        )
        upstream.on('error', () => {
          res.writeHead(502)
          res.end()
        })
        req.pipe(upstream)
      })
      edge.on('upgrade', (req, socket, head) => {
        const upstream = net.connect(helper.port, '127.0.0.1', () => {
          let headers = `${req.method} ${req.url} HTTP/1.1\r\n`
          for (const [key, value] of Object.entries(req.headers)) headers += `${key}: ${value}\r\n`
          upstream.write(headers + '\r\n')
          if (head.length) upstream.write(head)
          socket.pipe(upstream)
          upstream.pipe(socket)
        })
        tunnelSockets.add(upstream)
        tunnelSockets.add(socket)
        upstream.on('error', () => socket.destroy())
        socket.on('error', () => upstream.destroy())
      })
      let grant
      let parentRequests = 0
      const parentHandler = (req, res) => {
        parentRequests++
        res.setHeader('Content-Type', 'text/html')
        const policy = `frame-src ${proxyOrigin} blob: data:; object-src 'none'`
        if (!cachedParent) res.setHeader('Content-Security-Policy', policy)
        const meta = cachedParent
          ? `<script>const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content=${JSON.stringify(policy)};document.head.append(meta)</script>`
          : ''
        // Deliberately no COOP/COEP, matching today's installed Hermes PWA.
        res.end(
          `${meta}<iframe id="browser" sandbox="allow-scripts allow-same-origin allow-forms" allow="autoplay; encrypted-media" src="${proxyOrigin}${sameOrigin ? '/browser-proxy/' : '/'}#ticket=${grant.ticket}" style="width:100%;height:90vh"></iframe><script>window.events=[];window.addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.origin===${JSON.stringify(proxyOrigin)})events.push(e.data)});window.send=(url)=>document.querySelector('iframe').contentWindow.postMessage({protocol:'hermes-proxy-v1',command:{type:'navigate',url}},${JSON.stringify(proxyOrigin)});</script>`
        )
      }
      const parent = https.createServer(tls, parentHandler)
      const parentPort = await listen(parent),
        parentOrigin = sameOrigin ? proxyOrigin : `https://parent.example.org:${parentPort}`
      grant = await helper.mint(parentOrigin, false)
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--ignore-certificate-errors',
          '--host-resolver-rules=MAP proxy.example.net 127.0.0.1, MAP parent.example.org 127.0.0.1',
          '--no-proxy-server'
        ]
      })
      try {
        const context = await browser.newContext({ ignoreHTTPSErrors: true })
        if (cachedParent)
          await context.addInitScript(() => {
            globalThis.SharedWorker = undefined
          })
        const page = await context.newPage()
        page.on('console', message => {
          if (message.type() === 'error') console.log('browser:', message.text().slice(0, 400))
        })
        page.on('pageerror', error => console.log('pageerror:', error.message))
        await page.goto(parentOrigin + (sameOrigin ? '/desktop/' : '/'))
        assert.equal(await page.evaluate(() => crossOriginIsolated), false)
        assert.equal(await page.evaluate(() => typeof SharedArrayBuffer), 'undefined')
        await page.waitForFunction(() => events.some(event => event.type === 'ready'), null, { timeout: 30_000 })
        if (sameOrigin) {
          const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(reg => reg.scope))
          assert.deepEqual(scopes, [proxyOrigin + '/browser-proxy/'])
          assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null, 'Proxy SW does not control Desktop')
        }
        const html =
          '<!doctype html><html><head><title>Native proxy fixture</title></head><body><h1>Native proxy fixture</h1><input aria-label="Phone input"><button id="play">Play</button><p id="fetched">Loading</p><img src="https://httpbin.org/image/png"><audio src="https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3" preload="auto"></audio><script>fetch("https://httpbin.org/anything").then(r=>r.json()).then(v=>document.querySelector("#fetched").textContent=v.method);document.querySelector("#play").onclick=()=>document.querySelector("audio").play();</script></body></html>'
        const fixture = 'https://httpbin.org/base64/' + encodeURIComponent(Buffer.from(html).toString('base64'))
        const redirect = 'https://httpbin.org/redirect-to?url=' + encodeURIComponent(fixture)
        const site = page.frameLocator('#browser').frameLocator('iframe')
        await page.evaluate(() => send('https://httpbin.org/anything'))
        await site.locator('body').getByText(/"headers"/).waitFor({ timeout: 40_000 })
        const navigation = JSON.parse(await site.locator('body').innerText())
        assert.equal(navigation.headers['Sec-Fetch-Dest'], 'document', 'Browser tab is a logical top-level page')
        await page.evaluate(url => send(url), redirect)
        await site.getByRole('heading', { name: 'Native proxy fixture' }).waitFor({ timeout: 40_000 })
        await site.getByText('GET', { exact: true }).waitFor({ timeout: 20_000 })
        await site.getByRole('textbox', { name: 'Phone input' }).fill('client native input')
        assert.equal(await site.getByRole('textbox', { name: 'Phone input' }).inputValue(), 'client native input')
        await site.locator('img').evaluate(img => img.decode())
        await site.locator('audio').evaluate(
          audio =>
            new Promise((resolve, reject) => {
              if (audio.readyState >= 2) return resolve()
              audio.onloadeddata = resolve
              audio.onerror = () => reject(new Error('Media failed'))
              setTimeout(() => reject(new Error('Media timed out')), 20_000)
            })
        )
        await site.getByRole('button', { name: 'Play' }).click()
        await page.waitForTimeout(1000)
        assert.ok(
          await site.locator('audio').evaluate(audio => audio.currentTime > 0.1),
          'Native browser media playback advances'
        )
        console.log('REAL_PROXY_RENDER_MEDIA_INPUT_REDIRECT_PASS', await site.locator('body').innerText())
        await site.locator('body').evaluate(() => history.pushState({}, '', '/hermes-spa-navigation#music'))
        await page.waitForFunction(() => events.some(event => event.url === 'https://httpbin.org/hermes-spa-navigation#music'))
        await site.locator('body').evaluate(body => {
          const link = document.createElement('a')
          link.href = 'https://httpbin.org/anything'
          link.textContent = 'Navigate within the browser tab'
          body.append(link)
        })
        await site.getByRole('link', { name: 'Navigate within the browser tab' }).click()
        await site.locator('body').getByText(/"headers"/).waitFor({ timeout: 40_000 })
        const linkedNavigation = JSON.parse(await site.locator('body').innerText())
        assert.equal(linkedNavigation.headers['Sec-Fetch-Dest'], 'document', 'In-page links remain top-level navigations')
        assert.ok(!JSON.stringify(linkedNavigation.headers).includes(grant.ticket), 'Bootstrap capability never reaches targets')
        assert.equal(
          (await context.cookies()).some(cookie => cookie.name === '__Host-HermesProxy'),
          false
        )
        await page.evaluate(() => send('http://127.0.0.1/api/status'))
        await site
          .locator('body')
          .getByText(/error|failed|blocked|denied/i)
          .first()
          .waitFor({ timeout: 20_000 })
        const requestsBeforeEscape = parentRequests
        if (sameOrigin) {
          grant = await helper.mint(parentOrigin, false)
          await page.reload()
          await page.waitForFunction(() => events.some(event => event.type === 'ready'), null, { timeout: 30_000 })
          assert.equal(page.url(), parentOrigin + '/desktop/', 'Desktop remains outside proxy SW after reload')
          return
        }
        // Simulate the worst case: a compromised controller tries to become a
        // same-origin privileged Hermes frame. Parent CSP must reject navigation.
        await page
          .frameLocator('#browser')
          .locator('body')
          .evaluate((_, url) => {
            location.href = url
          }, parentOrigin + '/desktop/')
        await page.waitForTimeout(300)
        assert.equal(parentRequests, requestsBeforeEscape, 'Controller cannot navigate back to Hermes')
        assert.equal(page.url(), parentOrigin + '/')
        assert.ok(parentRequests <= 2, 'Proxied site must not access parent backend')
      } finally {
        await browser.close()
        for (const socket of tunnelSockets) socket.destroy()
        await helper.close()
        await close(edge)
        await close(parent)
        await rm(dir, { recursive: true, force: true })
      }
    }
  )
}
