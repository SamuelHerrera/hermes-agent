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

export function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8_192) { return false }

  try {
    const url = new URL(value)
    const hostname = url.hostname.replace(/\.$/u, '').toLowerCase()

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
      return false
    }

    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
      hostname.endsWith('.internal') || isPrivateIpv4(hostname) || isPrivateIpv6(hostname) ||
      isRestrictedBrowserPage(url)) {
      return false
    }

    return true
  } catch {
    return false
  }
}
