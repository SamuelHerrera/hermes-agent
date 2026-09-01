import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import {
  BROWSER_TO_HOST_MAX_BYTES,
  encodeNativeMessage,
  HOST_TO_BROWSER_MAX_BYTES,
  NativeMessageDecoder
} from './framing.js'

describe('Chrome native messaging framing', () => {
  it('decodes fragmented frames and preserves multibyte UTF-8', () => {
    const decoder = new NativeMessageDecoder(BROWSER_TO_HOST_MAX_BYTES)
    const frame = encodeNativeMessage({ text: 'héllö 🌍' }, BROWSER_TO_HOST_MAX_BYTES)
    const messages: unknown[] = []

    for (const byte of frame) {
      messages.push(...decoder.push(Buffer.from([byte])))
    }

    expect(messages).toEqual([{ text: 'héllö 🌍' }])
  })

  it('decodes multiple frames from one chunk', () => {
    const decoder = new NativeMessageDecoder(BROWSER_TO_HOST_MAX_BYTES)

    const chunk = Buffer.concat([
      encodeNativeMessage({ one: 1 }, BROWSER_TO_HOST_MAX_BYTES),
      encodeNativeMessage({ two: 2 }, BROWSER_TO_HOST_MAX_BYTES)
    ])

    expect(decoder.push(chunk)).toEqual([{ one: 1 }, { two: 2 }])
  })

  it('rejects browser messages larger than 64 MiB before buffering the payload', () => {
    const decoder = new NativeMessageDecoder(BROWSER_TO_HOST_MAX_BYTES)
    const header = Buffer.alloc(4)
    header.writeUInt32LE(BROWSER_TO_HOST_MAX_BYTES + 1)

    expect(() => decoder.push(header)).toThrow('exceeds 67108864 byte limit')
  })

  it('rejects host messages larger than 1 MiB', () => {
    expect(() => encodeNativeMessage(
      { payload: 'x'.repeat(HOST_TO_BROWSER_MAX_BYTES) },
      HOST_TO_BROWSER_MAX_BYTES
    )).toThrow('exceeds 1048576 byte limit')
  })

  it('rejects malformed UTF-8 and non-object JSON messages', () => {
    const invalidUtf8 = Buffer.from([2, 0, 0, 0, 0xc3, 0x28])
    expect(() => new NativeMessageDecoder(BROWSER_TO_HOST_MAX_BYTES).push(invalidUtf8))
      .toThrow('invalid UTF-8')

    const scalar = encodeNativeMessage('not an envelope', BROWSER_TO_HOST_MAX_BYTES)
    expect(() => new NativeMessageDecoder(BROWSER_TO_HOST_MAX_BYTES).push(scalar))
      .toThrow('native message must be a JSON object')
  })

  it('writes only framed JSON bytes to the supplied stdout stream', () => {
    const stdout = new PassThrough()
    const chunks: Buffer[] = []
    stdout.on('data', chunk => chunks.push(Buffer.from(chunk)))

    stdout.write(encodeNativeMessage({ type: 'bridge.ready' }, HOST_TO_BROWSER_MAX_BYTES))
    stdout.end()

    const output = Buffer.concat(chunks)
    expect(output.readUInt32LE(0)).toBe(output.length - 4)
    expect(JSON.parse(output.subarray(4).toString('utf8'))).toEqual({ type: 'bridge.ready' })
  })
})
