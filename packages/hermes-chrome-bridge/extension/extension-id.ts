const CHROME_ID_ALPHABET = 'abcdefghijklmnop'

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('extension public key must be valid base64')
  }

  let binary: string

  try {
    binary = atob(value)
  } catch {
    throw new Error('extension public key must be valid base64')
  }

  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  if (btoa(binary) !== value) {
    throw new Error('extension public key must be valid base64')
  }

  return bytes
}

export async function deriveExtensionId(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', decodeBase64(publicKey)))
  let extensionId = ''

  for (const byte of digest.subarray(0, 16)) {
    extensionId += CHROME_ID_ALPHABET[byte >> 4]
    extensionId += CHROME_ID_ALPHABET[byte & 0x0f]
  }

  return extensionId
}
