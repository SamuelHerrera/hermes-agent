'use strict'
;(async () => {
  let parentOrigin
  const publish = data => {
    if (parentOrigin) parent.postMessage({ protocol: 'hermes-proxy-v1', ...data }, parentOrigin)
  }
  try {
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket')
    history.replaceState(null, '', '/') // Capability never goes to HTTP logs or target URLs.
    if (!ticket) throw new Error('Open this browser from Hermes to obtain a fresh capability.')
    const response = await fetch('/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
      credentials: 'omit'
    })
    if (!response.ok) throw new Error('Browser capability expired. Reconnect in Hermes.')
    const grant = await response.json()
    parentOrigin = grant.parentOrigin
    const release = () => navigator.sendBeacon('/release', JSON.stringify({ session: grant.session }))
    window.addEventListener('pagehide', release, { once: true })
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    if (!registration.active)
      await new Promise((resolve, reject) => {
        const worker = registration.installing || registration.waiting
        const timeout = setTimeout(() => reject(new Error('Browser service worker timed out')), 15_000)
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') {
            clearTimeout(timeout)
            resolve()
          } else if (worker.state === 'redundant') {
            clearTimeout(timeout)
            reject(new Error('Browser service worker failed'))
          }
        })
      })
    const wispUrl = new URL(`/wisp/${encodeURIComponent(grant.session)}/`, location.origin)
    wispUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const scramjet = new $scramjetController.Controller({
      serviceworker: registration.active,
      transport: new LibcurlTransport.LibcurlClient({ wisp: wispUrl.href }),
      config: {
        prefix: '/service/',
        scramjetPath: '/assets/scram/scramjet.js',
        wasmPath: '/assets/scram/scramjet.wasm',
        injectPath: '/assets/controller/controller.inject.js'
      }
    })
    await scramjet.wait()
    class OptionalWorkerPlugin extends $scramjetController.ManagedPlugin {
      constructor() {
        super('optional-shared-worker', [])
      }
      install(frame) {
        // Alpha 2 unconditionally intercepts SharedWorker, aborting all later
        // hooks when mobile browsers omit it. Keep absence intact, not a fake API.
        this.tap(frame.hooks.init.pre, ({ client, window }) => {
          if (typeof window.SharedWorker === 'function') return
          const proxy = client.Proxy
          client.Proxy = function (name, handler) {
            if (name !== 'SharedWorker') return proxy.call(this, name, handler)
          }
        })
      }
    }
    const frame = scramjet.createFrame(undefined, {
      plugins: [
        new OptionalWorkerPlugin(),
        new $scramjetUtils.UrlWatcherPlugin(url => publish({ type: 'state', url, loading: false }))
      ]
    })
    frame.element.title = 'Proxied website'
    // No popups, top navigation, downloads, or access to the Hermes origin.
    frame.element.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    frame.element.setAttribute('allow', 'autoplay; encrypted-media')
    // Scramjet needs its own controller as the referrer to distinguish this
    // logical browser tab from a site's nested frames. Never send it cross-origin.
    frame.element.referrerPolicy = 'same-origin'
    document.getElementById('error').remove()
    document.body.appendChild(frame.element)
    const state = () => {
      try {
        publish({
          type: 'state',
          url: $scramjet.unrewriteUrl(frame.element.contentWindow.location.href, frame.context),
          title: frame.element.contentDocument?.title?.slice(0, 512),
          loading: false
        })
      } catch {
        publish({ type: 'state', loading: false })
      }
    }

    frame.element.addEventListener('load', state)
    window.addEventListener('message', event => {
      if (event.source !== parent || event.origin !== parentOrigin || event.data?.protocol !== 'hermes-proxy-v1') return
      const command = event.data.command
      if (!command || typeof command.type !== 'string') return
      try {
        if (command.type === 'navigate') {
          if (command.url === 'about:blank') {
            frame.element.src = 'about:blank'
            state()
            return
          }
          const url = new URL(command.url)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error('Only HTTP and HTTPS sites are supported')
          if ([new URL(parentOrigin).hostname, location.hostname].includes(url.hostname)) {
            throw new Error('Management destinations are denied')
          }
          publish({ type: 'state', loading: true })
          frame.go(url.href)
        } else if (['back', 'forward', 'reload'].includes(command.type)) frame[command.type]()
        else if (command.type === 'stop') frame.element.contentWindow.stop()
      } catch {
        publish({ type: 'error', error: 'Browser navigation unavailable' })
      }
    })
    setTimeout(() => {
      frame.element.remove()
      publish({ type: 'error', error: 'Private browser session expired. Reconnect to continue.' })
    }, grant.expiresIn)
    publish({ type: 'ready' })
  } catch (error) {
    const errorElement = document.getElementById('error') || document.body.appendChild(document.createElement('p'))
    errorElement.textContent = error.message
    publish({ type: 'error', error: error.message })
  }
})()
