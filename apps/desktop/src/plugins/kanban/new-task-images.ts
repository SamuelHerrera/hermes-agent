import { isSupportedPastedImageType } from './paste-images'
import type { KanbanAttachment } from './types'

export const NEW_TASK_IMAGE_ACCEPT = 'image/png,image/jpeg,image/jpg,image/gif,image/webp'

type UploadNewTaskImage = (taskId: string, file: File) => Promise<KanbanAttachment | null>

export function filterNewTaskImageFiles(files: Iterable<File>): File[] {
  return Array.from(files).filter(file => isSupportedPastedImageType(file.type))
}

export async function uploadNewTaskImages(
  taskId: string,
  files: File[],
  upload: UploadNewTaskImage
): Promise<Array<KanbanAttachment | null>> {
  const uploaded: Array<KanbanAttachment | null> = []

  for (const file of files) {
    uploaded.push(await upload(taskId, file))
  }

  return uploaded
}
