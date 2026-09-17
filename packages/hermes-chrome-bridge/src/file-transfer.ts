import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'

// The browser host and MCP backend need not share a filesystem. Only transfer
// bounded, explicitly approved bytes; never send backend paths to Chrome.
export async function prepareUploads(paths: string[]): Promise<Array<{ name: string, data: string }>> {
  const output: Array<{ name: string, data: string }> = []
  let total = 0

  for (const path of paths) {
    const name = basename(path)

    if (!isAbsolute(path) || /(?:^\.env|credential|secret|password|token|^id_(?:rsa|ed25519)|\.(?:pem|key|p12|pfx)$)/iu.test(name) || [...path].some(c => c.charCodeAt(0) < 32)) { throw new Error('Upload path is not an approved ordinary file.') }

    // Reject parent symlinks too; caller must approve the real, explicit path.
    if (await realpath(path) !== resolve(path)) { throw new Error('Upload symlinks are not supported; approve the real path.') }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)

    try {
      const stat = await file.stat()

      if (!stat.isFile() || stat.size > 262_144 - total) { throw new Error('Uploads are limited to 256 KiB total.') }
      const data = Buffer.alloc(stat.size + 1)
      const { bytesRead } = await file.read(data, 0, data.length, 0)

      if (bytesRead !== stat.size) { throw new Error('Upload changed while reading.') }
      total += bytesRead
      output.push({ name, data: data.subarray(0, bytesRead).toString('base64') })
    } finally { await file.close() }
  }

  return output
}
