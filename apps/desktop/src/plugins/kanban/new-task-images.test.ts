import { describe, expect, it, vi } from 'vitest'

import { filterNewTaskImageFiles, NEW_TASK_IMAGE_ACCEPT, uploadNewTaskImages } from './new-task-images'

describe('new task image staging helpers', () => {
  it('keeps only image formats accepted by the pasted-image backend', () => {
    const files = filterNewTaskImageFiles([
      new File(['png'], 'clip.png', { type: 'image/png' }),
      new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' }),
      new File(['text'], 'note.txt', { type: 'text/plain' }),
      new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' })
    ])

    expect(files.map(file => file.name)).toEqual(['clip.png', 'photo.jpg'])
    expect(NEW_TASK_IMAGE_ACCEPT).toContain('image/png')
    expect(NEW_TASK_IMAGE_ACCEPT).toContain('image/webp')
  })

  it('uploads staged images sequentially after a task id exists', async () => {
    const files = [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.webp', { type: 'image/webp' })
    ]

    const upload = vi.fn(async (taskId: string, file: File) => ({ id: `${taskId}-${file.name}`, filename: file.name }))

    const attachments = await uploadNewTaskImages('t_new', files, upload)

    expect(upload).toHaveBeenNthCalledWith(1, 't_new', files[0])
    expect(upload).toHaveBeenNthCalledWith(2, 't_new', files[1])
    expect(attachments.map(att => att?.filename)).toEqual(['first.png', 'second.webp'])
  })
})
