import { expect, it, vi } from 'vitest'

import { downloadToBrowserHost } from './debugger-download.js'

it('waits for completion and cancels oversized or interrupted downloads', async () => {
  const cancel = vi.fn(async () => undefined)
  const search = vi.fn().mockResolvedValueOnce([{ state: 'in_progress', bytesReceived: 2, totalBytes: 4, url: 'https://example.com/file' }]).mockResolvedValueOnce([{ state: 'complete', bytesReceived: 4, totalBytes: 4, url: 'https://example.com/file' }])
  const deps = { download: vi.fn(async () => 5), search, cancel, pause: async () => undefined }
  expect(await downloadToBrowserHost(deps, { url: 'https://example.com/file', filename: 'file.txt', maxBytes: 10 }, () => undefined)).toMatchObject({ completed: true, bytes: 4, host: 'browser' })
  search.mockResolvedValue([{ state: 'in_progress', bytesReceived: 20, url: 'https://example.com/file' }])
  await expect(downloadToBrowserHost(deps, { url: 'https://example.com/file', filename: 'file.txt', maxBytes: 10 }, () => undefined)).rejects.toThrow()
  expect(cancel).toHaveBeenCalledWith(5)
})
