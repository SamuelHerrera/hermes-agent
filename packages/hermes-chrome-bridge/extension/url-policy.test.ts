import { afterEach, describe, expect, it } from 'vitest'

import { isControllableHttpUrl, isPublicHttpUrl, setNetworkMode } from './url-policy.js'

afterEach(() => setNetworkMode(undefined))

describe('development network policy', () => {
  it.each([
    'http://localhost:3000/', 'http://app.localhost/', 'http://127.0.0.1:5173/',
    'http://[::1]:8000/', 'http://192.168.68.64:9119/', 'http://10.0.0.2/',
    'http://172.16.0.1/', 'http://100.64.0.1/', 'http://hp.local/', 'http://dev.internal/',
    'http://[fd12::1]/', 'http://[::ffff:192.168.68.64]/', 'https://example.com/'
  ])('allows development host by default: %s', url => {
    expect(isControllableHttpUrl(url)).toBe(true)
  })

  it.each([
    'http://169.254.169.254/latest/meta-data/', 'http://metadata.google.internal/',
    'http://100.100.100.200/', 'http://[fd00:ec2::254]/', 'http://[::ffff:a9fe:a9fe]/',
    'http://224.0.0.1/', 'http://[ff02::1]/', 'chrome://settings/',
    'file:///tmp/example', 'http://user:password@localhost/',
    'https://chromewebstore.google.com/', 'https://chrome.google.com/webstore/'
  ])('retains infrastructure and non-web boundaries: %s', url => {
    expect(isControllableHttpUrl(url)).toBe(false)
  })

  it('can restrict all consumers to public mode', () => {
    setNetworkMode('public')
    expect(isControllableHttpUrl('http://localhost:3000')).toBe(false)
    expect(isControllableHttpUrl('https://example.com')).toBe(true)
    expect(isPublicHttpUrl('http://[::ffff:c0a8:4401]/')).toBe(false)
  })

  it('fails closed on invalid stored policy', () => {
    setNetworkMode({ mode: 'development' })
    expect(isControllableHttpUrl('http://127.1/')).toBe(false)
  })
})
