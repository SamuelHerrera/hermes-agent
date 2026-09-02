interface ScreenshotDependencies {
  beforeCapture?(tabId: number): Promise<void>
  captureVisibleTab(
    windowId: number,
    options: { format: 'jpeg' | 'png', quality?: number }
  ): Promise<string>
  tabs: {
    get(tabId: number): Promise<{ id?: number, windowId?: number }>
    query(options: { active: true, windowId: number }): Promise<Array<{ id?: number }>>
    update(tabId: number, options: { active: true }): Promise<unknown>
  }
}

export class ScreenshotError extends Error {
  public constructor(
    public readonly code: 'CAPTURE_FAILED' | 'INVALID_SCREENSHOT' | 'SCREENSHOT_TOO_LARGE',
    message: string
  ) {
    super(message)
    this.name = 'ScreenshotError'
  }
}

export interface ScreenshotService {
  capture(options: {
    format: 'jpeg' | 'png'
    quality?: number
    tabId: number
  }): Promise<{ bytes: number, dataUrl: string, format: 'jpeg' | 'png' }>
}

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024

function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0

  return Math.floor(base64.length * 3 / 4) - padding
}

export function createScreenshotService(dependencies: ScreenshotDependencies): ScreenshotService {
  return {
    async capture({ format, quality, tabId }) {
      if (!Number.isInteger(tabId) || tabId <= 0 || (format !== 'jpeg' && format !== 'png') ||
        (quality !== undefined && (!Number.isInteger(quality) || quality < 1 || quality > 100))) {
        throw new ScreenshotError('CAPTURE_FAILED', 'The screenshot request is invalid.')
      }

      let restoreTabId: number | undefined

      try {
        const tab = await dependencies.tabs.get(tabId)

        if (!Number.isInteger(tab.windowId)) {
          throw new ScreenshotError('CAPTURE_FAILED', 'The screenshot target is unavailable.')
        }

        const activeTabs = await dependencies.tabs.query({ active: true, windowId: tab.windowId as number })
        restoreTabId = activeTabs.find(candidate => Number.isInteger(candidate.id))?.id

        if (restoreTabId !== tabId) { await dependencies.tabs.update(tabId, { active: true }) }

        await dependencies.beforeCapture?.(tabId)

        const dataUrl = await dependencies.captureVisibleTab(tab.windowId as number, {
          format,
          ...(format === 'jpeg' && quality !== undefined ? { quality } : {})
        })

        const prefix = `data:image/${format};base64,`

        if (!dataUrl.startsWith(prefix)) {
          throw new ScreenshotError('INVALID_SCREENSHOT', 'The browser returned an invalid screenshot.')
        }

        const encoded = dataUrl.slice(prefix.length)
        const bytes = decodedBytes(encoded)

        if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || bytes < 0) {
          throw new ScreenshotError('INVALID_SCREENSHOT', 'The browser returned an invalid screenshot.')
        }

        if (bytes > MAX_SCREENSHOT_BYTES) {
          throw new ScreenshotError('SCREENSHOT_TOO_LARGE', 'The screenshot exceeds the size limit.')
        }

        return { bytes, dataUrl, format }
      } catch (error) {
        if (error instanceof ScreenshotError) { throw error }

        throw new ScreenshotError('CAPTURE_FAILED', 'The screenshot capture failed.')
      } finally {
        if (restoreTabId !== undefined && restoreTabId !== tabId) {
          try { await dependencies.tabs.update(restoreTabId, { active: true }) } catch { /* Best-effort restoration. */ }
        }
      }
    }
  }
}
