import { cn } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

const ATTACHMENT_IMAGE_PREFIX = '/api/plugins/kanban/attachments/'

function isKanbanAttachmentUrl(src: string): boolean {
  try {
    const url = new URL(src, window.location.origin)

    return url.pathname.startsWith(ATTACHMENT_IMAGE_PREFIX)
  } catch {
    return false
  }
}

function unescapeMarkdownAlt(alt: string): string {
  return alt.replace(/\\([\\\]])/g, '$1')
}

function imageLine(line: string): null | { alt: string; src: string } {
  const match = line.match(/^!\[(.*)]\(([^\s)]+)\)\s*$/)

  if (!match) {
    return null
  }

  const [, alt, src] = match

  if (!src || !isKanbanAttachmentUrl(src)) {
    return null
  }

  return { alt: unescapeMarkdownAlt(alt || 'pasted image'), src }
}

export async function resolveKanbanAttachmentImageSrc(src: string): Promise<string> {
  if (!isKanbanAttachmentUrl(src) || !window.hermesDesktop?.getConnection) {
    return src
  }

  const connection = await window.hermesDesktop.getConnection().catch(() => null)

  if (!connection?.baseUrl) {
    return src
  }

  const url = new URL(src, connection.baseUrl)

  if (connection.authMode !== 'oauth' && connection.token) {
    url.searchParams.set('token', connection.token)
  }

  return url.toString()
}

function AttachmentImage({ alt, src }: { alt: string; src: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(src)

  useEffect(() => {
    let cancelled = false

    void resolveKanbanAttachmentImageSrc(src).then(next => {
      if (!cancelled) {
        setResolvedSrc(next)
      }
    })

    return () => {
      cancelled = true
    }
  }, [src])

  return (
    <a className="block" href={resolvedSrc} rel="noreferrer" target="_blank">
      <img
        alt={alt}
        className="mt-1 max-h-72 max-w-full rounded-md border border-(--ui-stroke-tertiary) object-contain"
        loading="lazy"
        src={resolvedSrc}
      />
    </a>
  )
}

export function KanbanCommentBody({ body, className }: { body: string; className?: string }) {
  const nodes: React.ReactNode[] = []
  const text: string[] = []

  const flushText = () => {
    if (!text.length) {
      return
    }

    nodes.push(
      <p className="whitespace-pre-wrap" key={`text-${nodes.length}`}>
        {text.join('\n')}
      </p>
    )
    text.length = 0
  }

  for (const line of body.split('\n')) {
    const image = imageLine(line)

    if (!image) {
      text.push(line)

      continue
    }

    flushText()
    nodes.push(<AttachmentImage alt={image.alt} key={`image-${nodes.length}`} src={image.src} />)
  }

  flushText()

  return <div className={cn('flex flex-col gap-1 text-(--ui-text-tertiary)', className)}>{nodes}</div>
}
