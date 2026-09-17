export const NETWORK_MODE_KEY = 'hermesChromeBridgeNetworkMode'
let networkMode: 'development' | 'public' = 'development'

export function setNetworkMode(value: unknown): void {
  networkMode = value === undefined || value === 'development' ? 'development' : 'public'
}

function mappedIpv4(hostname: string): string {
  const match = /^\[::ffff:([\da-f]+):([\da-f]+)\]$/u.exec(hostname)

  if (match === null) { return hostname }
  const high = Number.parseInt(match[1] as string, 16)
  const low = Number.parseInt(match[2] as string, 16)

  return [high >> 8, high & 255, low >> 8, low & 255].join('.')
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.')

  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/u.test(part))) { return false }
  const octets = parts.map(Number)

  if (octets.some(octet => octet < 0 || octet > 255)) { return true }
  const [first = 0, second = 0] = octets

  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) || first >= 224
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase()

  if (!normalized.includes(':')) { return false }

  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || /^fe[89ab]/u.test(normalized) || normalized.startsWith('ff') ||
    normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
}

function isRestrictedBrowserPage(url: URL): boolean {
  const hostname = url.hostname.toLowerCase()

  return hostname === 'chromewebstore.google.com' ||
    (hostname === 'chrome.google.com' && url.pathname.toLowerCase().startsWith('/webstore'))
}

function permittedUrl(value: unknown, development: boolean): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8_192) { return false }

  try {
    const url = new URL(value)
    const hostname = mappedIpv4(url.hostname.replace(/\.$/u, '').toLowerCase())

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
      return false
    }

    if (isRestrictedBrowserPage(url) || hostname === 'metadata.google.internal' ||
      hostname.endsWith('.metadata.google.internal') || hostname === '100.100.100.200' ||
      hostname === '[fd00:ec2::254]' || hostname.startsWith('169.254.') ||
      hostname === '[::]' || /^\[ff/iu.test(hostname) ||
      (/^\d+\.\d+\.\d+\.\d+$/u.test(hostname) && Number(hostname.split('.')[0]) >= 224)) {
      return false
    }

    if (!development && (hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') ||
      (!hostname.includes('.') && !hostname.includes(':')) ||
      isPrivateIpv4(hostname) || isPrivateIpv6(hostname))) { return false }

    return true
  } catch {
    return false
  }
}

/** Strict hostname policy; not a DNS resolver or a network firewall. */
export function isPublicHttpUrl(value: unknown): value is string {
  return permittedUrl(value, false)
}

/** Development access is intentional; metadata and browser chrome remain excluded. */
export function isControllableHttpUrl(value: unknown): value is string {
  return permittedUrl(value, networkMode === 'development')
}
