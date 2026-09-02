import type { FC } from 'react'
import { Fragment, useMemo } from 'react'

import { DirectiveContent } from '@/components/assistant-ui/directive-text'
import { tokenizeInlineMarkdown } from '@/lib/inline-markdown'
import { cn } from '@/lib/utils'

// User messages should render the bare-minimum of markdown: backtick `code`
// spans and ``` fenced blocks. We deliberately don't pull in the full
// assistant Markdown pipeline (Streamdown + KaTeX + syntax highlighter)
// because user input rarely contains structured docs and the heavy pipeline
// adds a lot of runtime cost per bubble.
//
// Directive chips (`@file:`, `@image:`, ...) still resolve via DirectiveContent
// inside the plain-text segments.

interface FenceSegment {
  kind: 'fence'
  code: string
  lang: string | null
}

interface InlineSegment {
  kind: 'inline'
  text: string
}

type TopSegment = FenceSegment | InlineSegment

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g

function splitFences(text: string): TopSegment[] {
  const segments: TopSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(FENCE_RE)) {
    const start = match.index ?? 0

    if (start > cursor) {
      segments.push({ kind: 'inline', text: text.slice(cursor, start) })
    }

    segments.push({
      kind: 'fence',
      lang: (match[1] || '').trim() || null,
      code: match[2] ?? ''
    })
    cursor = start + match[0].length
  }

  if (cursor < text.length) {
    segments.push({ kind: 'inline', text: text.slice(cursor) })
  }

  return segments
}

interface UserMessageTextProps {
  text: string
  className?: string
}

export const UserMessageText: FC<UserMessageTextProps> = ({ className, text }) => {
  const top = useMemo(() => splitFences(text), [text])

  return (
    <span className={cn('block', className)} data-slot="aui_user-message-text">
      {top.map((segment, segmentIndex) => {
        if (segment.kind === 'fence') {
          return (
            <pre
              className="my-1.5 max-w-full overflow-x-auto rounded-md border border-(--ui-stroke-tertiary) bg-[color-mix(in_srgb,currentColor_5%,transparent)] px-2.5 py-2 font-mono text-[0.86em] leading-snug"
              data-slot="aui_user-fence"
              key={`fence-${segmentIndex}`}
            >
              <code className="block whitespace-pre">{segment.code}</code>
            </pre>
          )
        }

        return (
          <Fragment key={`inline-${segmentIndex}`}>
            <InlineSegmentView text={segment.text} />
          </Fragment>
        )
      })}
    </span>
  )
}

const InlineSegmentView: FC<{ text: string }> = ({ text }) => {
  const nodes = useMemo(() => tokenizeInlineMarkdown(text), [text])

  return (
    // styles.css bidi hook (#44150); whitespace-pre-line makes each line its own
    // UAX#9 paragraph so it resolves direction independently.
    <span className="wrap-anywhere block whitespace-pre-line" data-slot="aui_user-inline-text">
      {nodes.map((node, nodeIndex) =>
        node.kind === 'code' ? (
          <code
            className="mx-px rounded bg-[color-mix(in_srgb,currentColor_8%,transparent)] px-1 py-px font-mono text-[0.92em]"
            data-slot="aui_user-inline-code"
            key={`code-${nodeIndex}`}
          >
            {node.text}
          </code>
        ) : node.kind === 'strong' ? (
          <strong className="font-semibold text-foreground" data-slot="aui_user-inline-strong" key={`strong-${nodeIndex}`}>
            {node.text}
          </strong>
        ) : node.kind === 'em' ? (
          <em className="italic" data-slot="aui_user-inline-em" key={`em-${nodeIndex}`}>
            {node.text}
          </em>
        ) : node.kind === 'strike' ? (
          <del className="line-through decoration-current/55" data-slot="aui_user-inline-strike" key={`strike-${nodeIndex}`}>
            {node.text}
          </del>
        ) : (
          // Pass plain-text bits through DirectiveContent so @file:/@url: chips
          // still render. DirectiveContent already preserves whitespace.
          <Fragment key={`text-${nodeIndex}`}>
            <DirectiveContent text={node.text} />
          </Fragment>
        )
      )}
    </span>
  )
}
