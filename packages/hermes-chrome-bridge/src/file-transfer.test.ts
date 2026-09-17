import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { prepareUploads } from './file-transfer.js'

it('transfers explicit approved bytes rather than backend paths and rejects secrets/symlinks/oversize', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'hermes-upload-')))

  try {
    const path = join(dir, 'report.txt')
    await writeFile(path, 'approved file')
    expect(await prepareUploads([path])).toEqual([{ name: 'report.txt', data: Buffer.from('approved file').toString('base64') }])
    await writeFile(join(dir, '.env'), 'secret')
    await expect(prepareUploads([join(dir, '.env')])).rejects.toThrow()
    await symlink(path, join(dir, 'alias.txt'))
    await expect(prepareUploads([join(dir, 'alias.txt')])).rejects.toThrow()
    await writeFile(path, Buffer.alloc(262145))
    await expect(prepareUploads([path])).rejects.toThrow()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
