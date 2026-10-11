// Adapt the declared bare-mux worker distribution, without vendoring it.
self.onconnect = null
importScripts('/assets/baremux/worker.js')
self.onmessage = event => {
  if (event.data?.type !== 'hermes-proxy-baremux-port-v1' || event.ports.length !== 1) return
  const connection = new MessageEvent('connect', { ports: event.ports })
  if (typeof self.onconnect === 'function') self.onconnect(connection)
  else self.dispatchEvent(connection)
}
