const RUNTIME_CHANNEL_SECRET = 'hcb-runtime-v1:c167e1e7cc7d4d1aa6f10f4d859f70ed'

const encoder = new TextEncoder()

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function runtimeChannelAuth(payload: Record<string, unknown>): Promise<string> {
  const encoded = encoder.encode(`${RUNTIME_CHANNEL_SECRET}\0${JSON.stringify(payload)}`)
  const digest = await crypto.subtle.digest('SHA-256', encoded)

  return toHex(digest)
}
