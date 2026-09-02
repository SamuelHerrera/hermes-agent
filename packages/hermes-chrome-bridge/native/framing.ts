import { endianness } from 'node:os'

export const BROWSER_TO_HOST_MAX_BYTES = 64 * 1024 * 1024
export const HOST_TO_BROWSER_MAX_BYTES = 1024 * 1024

const IS_LITTLE_ENDIAN = endianness() === 'LE'

function readLength(buffer: Buffer): number {
  return IS_LITTLE_ENDIAN ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0)
}

function writeLength(buffer: Buffer, length: number): void {
  if (IS_LITTLE_ENDIAN) {
    buffer.writeUInt32LE(length)
  } else {
    buffer.writeUInt32BE(length)
  }
}

export function encodeNativeMessage(value: unknown, maxBytes: number): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8')

  if (payload.length > maxBytes) {
    throw new Error(`native message size ${payload.length} exceeds ${maxBytes} byte limit`)
  }

  const header = Buffer.allocUnsafe(4)
  writeLength(header, payload.length)

  return Buffer.concat([header, payload])
}

export class NativeMessageDecoder {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  public constructor(private readonly maxBytes: number) {}

  public push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const messages: unknown[] = []

    while (this.buffer.length >= 4) {
      const payloadLength = readLength(this.buffer)

      if (payloadLength > this.maxBytes) {
        this.buffer = Buffer.alloc(0)
        throw new Error(`native message size ${payloadLength} exceeds ${this.maxBytes} byte limit`)
      }

      if (this.buffer.length < payloadLength + 4) {
        break
      }

      const payload = this.buffer.subarray(4, payloadLength + 4)
      this.buffer = this.buffer.subarray(payloadLength + 4)
      let text: string

      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(payload)
      } catch {
        throw new Error('native message contains invalid UTF-8')
      }

      const value = JSON.parse(text) as unknown

      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('native message must be a JSON object')
      }

      messages.push(value)
    }

    return messages
  }
}
