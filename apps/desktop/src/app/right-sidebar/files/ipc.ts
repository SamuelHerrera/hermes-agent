import type { HermesReadDirEntry, HermesReadDirResult } from '@/global'
import { readDesktopDir } from '@/lib/desktop-fs'
import { ALWAYS_EXCLUDED } from '@/lib/excluded-paths'

export type ProjectTreeEntry = HermesReadDirEntry

// Git ignore rules control version tracking, not visibility in the file explorer.
export async function readProjectDir(dirPath: string): Promise<HermesReadDirResult> {
  if (!window.hermesDesktop) {
    return { entries: [], error: 'no-bridge' }
  }

  const result = await readDesktopDir(dirPath)
  const entries = (result?.entries ?? []).filter(entry => !ALWAYS_EXCLUDED.has(entry.name))

  return { ...result, entries }
}
