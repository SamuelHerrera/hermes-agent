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
    const { ScramjetController } = $scramjetLoadController()
    const scramjet = new ScramjetController({
      prefix: '/service/',
      files: {
        wasm: '/assets/scram/scramjet.wasm.wasm',
        all: '/assets/scram/scramjet.all.js',
        sync: '/assets/scram/scramjet.sync.js'
      }
    })
    await scramjet.init()
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/service/' })
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
    const connection = new BareMux.BareMuxConnection('/assets/baremux/worker.js')
    const wispUrl = new URL(`/wisp/${encodeURIComponent(grant.session)}/`, location.origin)
    wispUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    await connection.setTransport('/assets/libcurl/index.mjs', [{ websocket: wispUrl.href }])
    const frame = scramjet.createFrame()
    frame.frame.title = 'Proxied website'
    // No popups, top navigation, downloads, or access to the Hermes origin.
    frame.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    frame.frame.setAttribute('allow', 'autoplay; encrypted-media')
    frame.frame.referrerPolicy = 'no-referrer'
    document.getElementById('error').remove()
    document.body.appendChild(frame.frame)
    const state = () => {
      try {
        publish({
          type: 'state',
          url: frame.url.href,
          title: frame.frame.contentDocument?.title?.slice(0, 512),
          loading: false
        })
      } catch {
        publish({ type: 'state', loading: false })
      }
    }
    frame.addEventListener('urlchange', state)
    frame.addEventListener('navigate', () => publish({ type: 'state', loading: true }))
    frame.frame.addEventListener('load', state)
    window.addEventListener('message', event => {
      if (event.source !== parent || event.origin !== parentOrigin || event.data?.protocol !== 'hermes-proxy-v1') return
      const command = event.data.command
      if (!command || typeof command.type !== 'string') return
      try {
        if (command.type === 'navigate') {
          if (command.url === 'about:blank') {
            frame.frame.src = 'about:blank'
            state()
            return
          }
          const url = new URL(command.url)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error('Only HTTP and HTTPS sites are supported')
          if ([new URL(parentOrigin).hostname, location.hostname].includes(url.hostname)) {
            throw new Error('Management destinations are denied')
          }
          frame.go(url.href)
        } else if (['back', 'forward', 'reload'].includes(command.type)) frame[command.type]()
        else if (command.type === 'stop') frame.frame.contentWindow.stop()
      } catch {
        publish({ type: 'error', error: 'Browser navigation unavailable' })
      }
    })
    setTimeout(() => {
      frame.frame.remove()
      publish({ type: 'error', error: 'Private browser session expired. Reconnect to continue.' })
    }, grant.expiresIn)
    publish({ type: 'ready' })
  } catch (error) {
    document.getElementById('error').textContent = error.message
    publish({ type: 'error', error: error.message })
  }
})()
