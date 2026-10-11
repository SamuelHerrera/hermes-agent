importScripts('/assets/controller/controller.sw.js')
const policy =
  "default-src 'self' data: blob:; script-src 'self' data: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; form-action 'self'; object-src 'none'; base-uri 'self'"
self.addEventListener('fetch', event => {
  if (!$scramjetController.shouldRoute(event)) return
  event.respondWith((async () => {
    const response = await $scramjetController.route(event)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', policy)
    headers.set('Referrer-Policy', 'same-origin')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Cross-Origin-Resource-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })())
})
