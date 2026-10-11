import { lookup } from 'node:dns/promises'
import net from 'node:net'
import ipaddr from 'ipaddr.js'

export function publicAddress(value) {
  try {
    const ip = ipaddr.parse(value)
    // Only ordinary global unicast. Reject mapped IPv4, 6to4, Teredo,
    // NAT64, multicast, documentation, CGNAT, loopback and reserved ranges.
    return ip.range() === 'unicast'
  } catch {
    return false
  }
}
export function hostname(value) {
  return String(value).toLowerCase().replace(/\.$/, '')
}
export class TargetPolicy {
  constructor(denied = [], resolver = name => lookup(name, { all: true })) {
    this.denied = new Set(denied.map(hostname))
    this.addresses = new Set()
    this.resolver = resolver
  }
  async denyHost(name) {
    name = hostname(name)
    this.denied.add(name)
    // Fail closed when management host DNS is unavailable.
    const results = await this.resolver(name)
    for (const entry of results) this.addresses.add(entry.address)
  }
  async resolve(name, port) {
    name = hostname(name)
    if (
      ![80, 443].includes(port) ||
      net.isIP(name) ||
      !/^[a-z0-9.-]{1,253}$/.test(name) ||
      [...this.denied].some(denied => name === denied || name.endsWith(`.${denied}`)) ||
      !name.includes('.') ||
      name.endsWith('.local') ||
      name.endsWith('.localhost')
    ) {
      throw new Error('Target denied')
    }
    const results = await this.resolver(name)
    if (!results.length || results.some(entry => !publicAddress(entry.address) || this.addresses.has(entry.address))) {
      throw new Error('Target denied')
    }
    // The caller connects to this exact address, not the hostname, preventing
    // a second DNS lookup/rebinding between validation and socket connect.
    return results.find(entry => net.isIP(entry.address) === 4)?.address || results[0].address
  }
}
