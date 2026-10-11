import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'
import { createProxy } from '../server.mjs'

function request(proxy, pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${proxy.port}${pathname}`,
      {
        method: body ? 'POST' : 'GET',
        headers: { host: 'proxy.example.net', origin: 'https://proxy.example.net', 'content-type': 'application/json' }
      },
      res => {
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(data), headers: res.headers }))
      }
    )
    req.on('error', reject)
    req.end(body ? JSON.stringify(body) : undefined)
  })
}
async function session(proxy) {
  const ticket = await proxy.mint('https://hermes.example.org', false)
  const result = await request(proxy, '/bootstrap', { ticket: ticket.ticket })
  return result.json().session
}
function socket(proxy, id, origin = 'https://proxy.example.net') {
  return new WebSocket(`ws://127.0.0.1:${proxy.port}/wisp/${id}/`, {
    headers: { host: 'proxy.example.net', ...(origin ? { origin } : {}) }
  })
}
function connectPacket(id, host, port, type = 1) {
  const buffer = Buffer.alloc(8 + Buffer.byteLength(host))
  buffer[0] = 1
  buffer.writeUInt32LE(id, 1)
  buffer[5] = type
  buffer.writeUInt16LE(port, 6)
  buffer.write(host, 8)
  return buffer
}

test('one-time capability, expiry and secure host-only optional cookie', async () => {
  const proxy = await createProxy({
    origin: 'https://proxy.example.net',
    port: 0,
    testOnly: true,
    ticketTTL: 100,
    sessionTTL: 150
  })
  try {
    const grant = await proxy.mint('https://hermes.example.org', false)
    const result = await request(proxy, '/bootstrap', { ticket: grant.ticket })
    assert.equal(result.status, 200)
    for (const value of ['__Host-HermesProxy=', 'HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', 'Path=/'])
      assert.ok(result.headers['set-cookie'][0].includes(value))
    assert.ok(!result.headers['set-cookie'][0].includes('Domain='))
    assert.equal((await request(proxy, '/bootstrap', { ticket: grant.ticket })).status, 401)
    for (let i = 0; i < 100 && proxy.sessions.size; i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(proxy.sessions.size, 0)
    const expired = await proxy.mint('https://hermes.example.org', false)
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.equal((await request(proxy, '/bootstrap', { ticket: expired.ticket })).status, 401)
  } finally {
    await proxy.close()
  }
})

test('Wisp rejects absent/foreign Origin and unknown sessions before upgrade', async () => {
  const proxy = await createProxy({ origin: 'https://proxy.example.net', port: 0, testOnly: true })
  try {
    const id = await session(proxy)
    for (const [cap, origin] of [
      [id, 'https://evil.example'],
      [id, ''],
      ['bad', 'https://proxy.example.net']
    ]) {
      const ws = socket(proxy, cap, origin)
      ws.on('error', () => {})
      const [, res] = await once(ws, 'unexpected-response')
      assert.equal(res.statusCode, 403)
      ws.terminate()
    }
  } finally {
    await proxy.close()
  }
})

test('authenticated Wisp blocks private IPs, DNS aliases and management ports', async () => {
  const proxy = await createProxy({
    origin: 'https://proxy.example.net',
    port: 0,
    testOnly: true,
    deniedHosts: ['hermes.example.org']
  })
  try {
    const id = await session(proxy)
    const ws = socket(proxy, id)
    const first = once(ws, 'message')
    await once(ws, 'open')
    await first
    for (const [host, port] of [
      ['127.0.0.1', 80],
      ['10.0.0.1', 443],
      ['localtest.me', 443],
      ['hermes.example.org', 443],
      ['example.com', 9119]
    ]) {
      ws.send(connectPacket(1, host, port))
      const [frame] = await once(ws, 'message')
      assert.equal(frame[0], 4, `${host}:${port} must get a Wisp CLOSE, never data`)
      assert.equal(frame.readUInt32LE(1), 1)
    }
    ws.terminate()
  } finally {
    await proxy.close()
  }
})

test('unknown/UDP stream types close the authenticated connection', async () => {
  const proxy = await createProxy({ origin: 'https://proxy.example.net', port: 0, testOnly: true })
  try {
    const id = await session(proxy)
    for (const type of [2, 99]) {
      const ws = socket(proxy, id)
      const first = once(ws, 'message')
      await once(ws, 'open')
      await first
      ws.send(connectPacket(1, 'example.com', 443, type))
      await once(ws, 'close')
    }
  } finally {
    await proxy.close()
  }
})

test('public suffix isolation rejects sibling origins, including multi-label suffixes', async () => {
  for (const [origin, parent] of [
    ['https://browser.example.org', 'https://hermes.example.org'],
    ['https://browser.example.co.uk', 'https://hermes.example.co.uk']
  ]) {
    const proxy = await createProxy({ origin, port: 0 })
    try {
      await assert.rejects(proxy.mint(parent, false), /Separate registrable/)
    } finally {
      await proxy.close()
    }
  }
})
