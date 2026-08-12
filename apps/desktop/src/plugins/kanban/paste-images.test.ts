import { describe, expect, it } from 'vitest'

import {
  attachmentMarkdownUrl,
  buildPastedImageComment,
  clipboardImageFiles,
  PastedImageUploadGuard
} from './paste-images'

describe('kanban pasted image helpers', () => {
  it('extracts image clipboard items as named files', () => {
    const blob = new Blob(['png-bytes'], { type: 'image/png' })

    const files = clipboardImageFiles({
      items: [
        { type: 'text/plain', getAsFile: () => new File(['hello'], 'hello.txt', { type: 'text/plain' }) },
        { type: 'image/png', getAsFile: () => blob }
      ]
    } as unknown as DataTransfer)

    expect(files).toHaveLength(1)
    expect(files[0]).toBeInstanceOf(File)
    expect(files[0].name).toBe('pasted-image-1.png')
    expect(files[0].type).toBe('image/png')
  })

  it('ignores image clipboard formats the pasted-image backend will not render inline', () => {
    const files = clipboardImageFiles({
      items: [
        { type: 'image/svg+xml', getAsFile: () => new File(['<svg/>'], 'clip.svg', { type: 'image/svg+xml' }) },
        { type: 'image/tiff', getAsFile: () => new File(['tiff'], 'clip.tiff', { type: 'image/tiff' }) },
        { type: 'image/webp', getAsFile: () => new Blob(['webp-bytes'], { type: 'image/webp' }) }
      ]
    } as unknown as DataTransfer)

    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('pasted-image-1.webp')
  })

  it('builds a comment that points at uploaded attachment ids', () => {
    expect(
      buildPastedImageComment('context', [
        { id: 7, filename: 'clip.png' },
        { id: '8', filename: 'diagram.jpg' }
      ])
    ).toBe(
      'context\n\n![clip.png](/api/plugins/kanban/attachments/7)\n![diagram.jpg](/api/plugins/kanban/attachments/8)'
    )
  })

  it('uses backend-provided attachment URLs and escapes alt text when building comment images', () => {
    expect(
      buildPastedImageComment('', [
        { id: 9, filename: 'bad ] name.png', url: '/api/plugins/kanban/attachments/9?board=ops' }
      ])
    ).toBe('![bad \\] name.png](/api/plugins/kanban/attachments/9?board=ops)')
  })

  it('falls back to id-derived attachment URLs', () => {
    expect(attachmentMarkdownUrl({ id: 'a/b' })).toBe('/api/plugins/kanban/attachments/a%2Fb')
  })

  it('blocks a duplicate paste batch while the first upload is pending', () => {
    const guard = new PastedImageUploadGuard()
    const file = new File(['png-bytes'], 'clip.png', { type: 'image/png', lastModified: 123 })

    expect(guard.begin([file])).toBe(true)
    expect(guard.begin([file])).toBe(false)

    guard.finish([file])
    expect(guard.begin([file])).toBe(true)
  })
})
