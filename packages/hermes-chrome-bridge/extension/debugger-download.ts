import { DebuggerError } from './debugger-service.js'
import { isControllableHttpUrl } from './url-policy.js'

interface DownloadState { state: string, bytesReceived: number, totalBytes?: number, url: string, finalUrl?: string, danger?: string }
interface Downloads {
  download(options: { url: string, filename: string, saveAs: boolean, conflictAction: 'uniquify' }): Promise<number>
  search(options: { id: number }): Promise<DownloadState[]>
  cancel(id: number): Promise<void>
  pause(): Promise<void>
}

export async function downloadToBrowserHost(deps: Downloads, args: Record<string, unknown>, check: () => void) {
  const url = String(args.url)

  if (!isControllableHttpUrl(url)) { throw new DebuggerError('URL_NOT_ALLOWED', 'The download URL is not permitted.') }
  check()
  const id = await deps.download({ url, filename: `hermes/${String(args.filename)}`, saveAs: false, conflictAction: 'uniquify' })
  const deadline = Date.now() + Number(args.timeoutMs ?? 30_000)
  const maximum = Number(args.maxBytes ?? 5_000_000)

  try {
    while (Date.now() < deadline) {
      check()
      const item = (await deps.search({ id }))[0]

      if (!item) { throw new DebuggerError('DOWNLOAD_LOST', 'Chrome no longer reports the download.') }

      if (!isControllableHttpUrl(item.finalUrl ?? item.url) || item.bytesReceived > maximum || (item.totalBytes ?? 0) > maximum) { throw new DebuggerError('DOWNLOAD_BLOCKED', 'The download exceeded its URL or size bound.') }

      if (item.danger && !['safe', 'accepted', 'deepScannedSafe'].includes(item.danger)) { throw new DebuggerError('DOWNLOAD_UNSAFE', 'Chrome flagged this download; no security prompt was bypassed.') }

      if (item.state === 'interrupted') { throw new DebuggerError('DOWNLOAD_INTERRUPTED', 'Chrome interrupted the download.') }

      if (item.state === 'complete') { check();

 return { completed: true, downloadId: id, bytes: item.bytesReceived, host: 'browser', directory: 'Downloads/hermes' } }

      await deps.pause()
    }

    throw new DebuggerError('DOWNLOAD_TIMEOUT', 'The download did not complete within its bound.')
  } catch (error) { await deps.cancel(id).catch(() => undefined); throw error }
}
