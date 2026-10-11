importScripts('/assets/scram/scramjet.all.js')
const { ScramjetServiceWorker } = $scramjetLoadWorker()
const scramjet = new ScramjetServiceWorker()
const policy =
  "default-src 'self' data: blob:; script-src 'self' data: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; form-action 'self'; object-src 'none'; base-uri 'self'"
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  event.respondWith(
    (async () => {
      await scramjet.loadConfig()
      if (!scramjet.route(event)) return fetch(event.request)
      const response = await scramjet.fetch(event)
      const headers = new Headers(response.headers)
      // Scramjet removes upstream CSP while rewriting. Put our boundary back on
      // the final response, including redirects, nested pages and worker scripts.
      headers.set('Content-Security-Policy', policy)
      headers.set('Referrer-Policy', 'same-origin')
      headers.set('X-Content-Type-Options', 'nosniff')
      let body = response.body
      if (event.request.mode === 'navigate' && headers.get('Content-Type')?.includes('text/html')) {
        // A mobile Worker adapter must run before Scramjet/bare-mux capture
        // browser globals. Preserve standards mode while injecting our bridge.
        let html = await response.text()
        const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || ''
        if (doctype) html = html.replace(doctype, '')
        body = `${doctype}<script src="/worker-bridge.js"></script>${html}`
        headers.delete('Content-Length')
        headers.delete('Content-Encoding')
      }
      return new Response(body, { status: response.status, statusText: response.statusText, headers })
    })()
  )
})
