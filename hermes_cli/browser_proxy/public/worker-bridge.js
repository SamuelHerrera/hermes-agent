// Bare-mux's SharedWorker API adapter for mobile engines without SharedWorker.
// Runs before Scramjet hooks. Only the isolated controller owns the worker;
// nested proxy documents get transferable ports, never any Hermes credential.
;(() => {
  if (typeof globalThis.SharedWorker === 'function') return
  const origin = location.origin
  const parentWindow = window.parent
  const post = window.postMessage
  const documentNode = document
  const WorkerCtor = Worker
  const URLCtor = URL
  const isController = ['/', '/index.html'].includes(location.pathname)
  const type = 'hermes-proxy-baremux-port-v1'
  let worker
  function connect(port) {
    worker ??= new WorkerCtor('/worker-adapter.js')
    worker.postMessage({ type, port }, [port])
  }
  addEventListener('message', event => {
    if (event.origin !== origin || event.data?.type !== type || event.ports.length !== 1) return
    if (isController) {
      // The controller's parent is Hermes and is explicitly NOT a port client.
      if (![...documentNode.querySelectorAll('iframe')].some(frame => frame.contentWindow === event.source)) return
      connect(event.ports[0])
    } else if (parentWindow !== window) {
      // Relay nested site frames up the proxy-only tree. The controller checks
      // the direct child source, and the proxy session has no Hermes authority.
      post.call(parentWindow, { type }, origin, event.ports)
    }
  })
  globalThis.SharedWorker = class ProxySharedWorker extends EventTarget {
    constructor(path) {
      super()
      const url = new URLCtor(path, origin)
      if (url.origin !== origin || url.pathname !== '/assets/baremux/worker.js') {
        throw new Error('Only the isolated bare-mux worker supports this mobile adapter')
      }
      const channel = new MessageChannel()
      this.port = channel.port1
      if (isController) connect(channel.port2)
      else if (parentWindow !== window) post.call(parentWindow, { type }, origin, [channel.port2])
      else throw new Error('Open this browser through authenticated Hermes Desktop')
    }
  }
})()
