import type { KanbanAttachment } from './types'

export function imageExtensionFromType(type: string | undefined): string {
  const clean = String(type || '')
    .toLowerCase()
    .split(';', 1)[0]

  if (clean === 'image/jpeg' || clean === 'image/jpg') {
    return 'jpg'
  }

  if (clean === 'image/gif') {
    return 'gif'
  }

  if (clean === 'image/webp') {
    return 'webp'
  }

  return 'png'
}

export function isSupportedPastedImageType(type: string | undefined): boolean {
  const clean = String(type || '')
    .toLowerCase()
    .split(';', 1)[0]

  return (
    clean === 'image/png' ||
    clean === 'image/jpeg' ||
    clean === 'image/jpg' ||
    clean === 'image/gif' ||
    clean === 'image/webp'
  )
}

export function clipboardImageFiles(data: null | Pick<DataTransfer, 'items'> | undefined): File[] {
  const items = data?.items ? Array.from(data.items) : []
  const files: File[] = []

  for (const item of items) {
    const type = String(item?.type || '')

    if (!isSupportedPastedImageType(type)) {
      continue
    }

    const file = item.getAsFile?.()

    if (!file) {
      continue
    }

    if (file.name) {
      files.push(file)

      continue
    }

    const name = `pasted-image-${files.length + 1}.${imageExtensionFromType(file.type || type)}`

    try {
      files.push(new File([file], name, { type: file.type || type || 'image/png' }))
    } catch {
      try {
        Object.defineProperty(file, 'name', { value: name })
      } catch {
        // Best effort for very old WebViews that cannot construct File from Blob.
      }

      files.push(file)
    }
  }

  return files
}

export function attachmentMarkdownUrl(attachment: Pick<KanbanAttachment, 'id'> & { url?: null | string }): string {
  if (attachment.url) {
    return attachment.url
  }

  return `/api/plugins/kanban/attachments/${encodeURIComponent(String(attachment.id))}`
}

function escapeMarkdownAlt(text: string): string {
  return text.replace(/([\\\]])/g, '\\$1')
}

export class PastedImageUploadGuard {
  private readonly pending = new Set<string>()

  begin(files: File[]): boolean {
    const keys = files.map(file => `${file.name}|${file.type}|${file.size}|${file.lastModified}`)

    if (keys.some(key => this.pending.has(key))) {
      return false
    }

    keys.forEach(key => this.pending.add(key))

    return true
  }

  finish(files: File[]): void {
    files.forEach(file => this.pending.delete(`${file.name}|${file.type}|${file.size}|${file.lastModified}`))
  }
}

export function buildPastedImageComment(
  prefix: string,
  attachments: Array<Pick<KanbanAttachment, 'filename' | 'id'> & { url?: null | string }>
): string {
  const text = prefix.trim()

  const imageLines = attachments
    .filter(attachment => attachment.id != null)
    .map(
      attachment =>
        `![${escapeMarkdownAlt(attachment.filename || 'pasted image')}](${attachmentMarkdownUrl(attachment)})`
    )

  return [text, imageLines.join('\n')].filter(Boolean).join('\n\n')
}
