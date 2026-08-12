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

const STRUCTURED_COMMENT_KEYS = new Set(['changed_files', 'commit', 'tests_run', 'verification', 'notes'])

function humanizeKey(key: string): string {
  const words = key.replace(/_/g, ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseStructuredComment(body: string): null | { prefix?: string; data: Record<string, unknown> } {
  const trimmed = body.trim()
  const jsonStart = trimmed.indexOf('{')

  if (jsonStart < 0) {
    return null
  }

  const prefix = trimmed.slice(0, jsonStart).trim()
  const jsonText = trimmed.slice(jsonStart)

  try {
    const parsed = JSON.parse(jsonText)

    if (!isRecord(parsed) || !Object.keys(parsed).some(key => STRUCTURED_COMMENT_KEYS.has(key))) {
      return null
    }

    return { prefix: prefix || undefined, data: parsed }
  } catch {
    return null
  }
}

function renderStructuredValue(value: unknown): React.ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-(--ui-text-quaternary)">None</span>
    }

    return (
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {value.map((item, index) => (
          <li className="whitespace-pre-wrap break-words" key={index}>
            {renderStructuredValue(item)}
          </li>
        ))}
      </ul>
    )
  }

  if (isRecord(value)) {
    return (
      <dl className="mt-1 space-y-1">
        {Object.entries(value).map(([key, nestedValue]) => (
          <div key={key}>
            <dt className="text-(--ui-text-quaternary)">{humanizeKey(key)}</dt>
            <dd>{renderStructuredValue(nestedValue)}</dd>
          </div>
        ))}
      </dl>
    )
  }

  if (value === null || value === undefined || value === '') {
    return <span className="text-(--ui-text-quaternary)">None</span>
  }

  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>
}

function renderStructuredCommentBody(body: string): React.ReactNode {
  const structured = parseStructuredComment(body)

  if (!structured) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      {structured.prefix && <p className="whitespace-pre-wrap">{structured.prefix}</p>}
      <dl className="space-y-2 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/35 p-2">
        {Object.entries(structured.data).map(([key, value]) => (
          <div key={key}>
            <dt className="font-medium text-(--ui-text-secondary)">{humanizeKey(key)}</dt>
            <dd className="mt-0.5">{renderStructuredValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function KanbanCommentBody({ body, className }: { body: string; className?: string }) {
  const structured = renderStructuredCommentBody(body)

  if (structured) {
    return <div className={cn('flex flex-col gap-1 text-(--ui-text-tertiary)', className)}>{structured}</div>
  }

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
