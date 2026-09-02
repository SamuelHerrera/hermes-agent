import { referenceRe } from '@/components/assistant-ui/reference-kinds'

export type InlineMarkdownKind = 'code' | 'strong' | 'em' | 'strike'

export interface InlineMarkdownTextToken {
  kind: 'text'
  text: string
}

export interface InlineMarkdownStyleToken {
  kind: InlineMarkdownKind
  markerClose: string
  markerOpen: string
  text: string
}

export type InlineMarkdownToken = InlineMarkdownTextToken | InlineMarkdownStyleToken

interface Candidate {
  end: number
  markerClose: string
  markerOpen: string
  priority: number
  start: number
  text: string
  type: InlineMarkdownKind
}

const INLINE_CODE_RE = /(`+)([^`\n][\s\S]*?)\1/g
const STRONG_ASTERISK_RE = /\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/g
const STRONG_UNDERSCORE_RE = /__([^\s_](?:[\s\S]*?[^\s_])?)__/g
const STRIKE_RE = /~~([^\s~](?:[\s\S]*?[^\s~])?)~~/g
const EMPHASIS_ASTERISK_RE = /\*([^\s*](?:[^*\n]*?[^\s*])?)\*/g
const EMPHASIS_UNDERSCORE_RE = /_([^\s_](?:[^_\n]*?[^\s_])?)_/g

const WORD_RE = /[\p{L}\p{N}_]/u

function protectedRanges(text: string) {
  return Array.from(text.matchAll(referenceRe())).map(match => ({
    end: (match.index ?? 0) + match[0].length,
    start: match.index ?? 0
  }))
}

function overlapsProtected(start: number, end: number, ranges: Array<{ end: number; start: number }>) {
  return ranges.some(range => start < range.end && end > range.start)
}

function underscoreTouchesWord(text: string, start: number, end: number) {
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''

  return WORD_RE.test(before) || WORD_RE.test(after)
}

function candidatesFor(
  text: string,
  ranges: Array<{ end: number; start: number }>,
  regex: RegExp,
  type: InlineMarkdownKind,
  marker: string,
  priority: number
): Candidate[] {
  return Array.from(text.matchAll(regex))
    .map(match => {
      const start = match.index ?? 0
      const end = start + match[0].length

      return {
        end,
        markerClose: type === 'code' ? (match[1] ?? marker) : marker,
        markerOpen: type === 'code' ? (match[1] ?? marker) : marker,
        priority,
        start,
        text: match[2] ?? match[1] ?? '',
        type
      }
    })
    .filter(candidate => {
      if (!candidate.text || overlapsProtected(candidate.start, candidate.end, ranges)) {
        return false
      }

      if (candidate.markerOpen.includes('_') && underscoreTouchesWord(text, candidate.start, candidate.end)) {
        return false
      }

      return true
    })
}

export function tokenizeInlineMarkdown(text: string): InlineMarkdownToken[] {
  if (!text) {
    return []
  }

  const ranges = protectedRanges(text)

  const candidates = [
    ...candidatesFor(text, ranges, INLINE_CODE_RE, 'code', '`', 0),
    ...candidatesFor(text, ranges, STRONG_ASTERISK_RE, 'strong', '**', 1),
    ...candidatesFor(text, ranges, STRONG_UNDERSCORE_RE, 'strong', '__', 1),
    ...candidatesFor(text, ranges, STRIKE_RE, 'strike', '~~', 1),
    ...candidatesFor(text, ranges, EMPHASIS_ASTERISK_RE, 'em', '*', 2),
    ...candidatesFor(text, ranges, EMPHASIS_UNDERSCORE_RE, 'em', '_', 2)
  ].sort((a, b) => a.start - b.start || a.priority - b.priority || b.end - a.end)

  const tokens: InlineMarkdownToken[] = []
  let cursor = 0

  for (const candidate of candidates) {
    if (candidate.start < cursor) {
      continue
    }

    if (candidate.start > cursor) {
      tokens.push({ kind: 'text', text: text.slice(cursor, candidate.start) })
    }

    tokens.push({
      kind: candidate.type,
      markerClose: candidate.markerClose,
      markerOpen: candidate.markerOpen,
      text: candidate.text
    })
    cursor = candidate.end
  }

  if (cursor < text.length) {
    tokens.push({ kind: 'text', text: text.slice(cursor) })
  }

  return tokens
}
