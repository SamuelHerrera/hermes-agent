const CHAT_FILE_HREF_PREFIX = '#file/'

export function isLikelyChatFilePath(value: string): boolean {
  const path = value.trim()

  if (!path || path.length > 4096 || /[\r\n]/.test(path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    return false
  }

  if (/^(?:\/|~\/|\.\.?[\\/]|[a-zA-Z]:[\\/]|\\\\)/.test(path)) {
    return true
  }

  if (/[\\/]/.test(path) && /(?:^|[\\/])[^\\/]+\.[a-z0-9][a-z0-9._-]{0,19}$/i.test(path)) {
    return true
  }

  return /^(?:\.?[a-z0-9][a-z0-9._-]*\.[a-z][a-z0-9_-]{0,19}|\.(?:env|gitignore|npmrc))$/i.test(path)
}

export function chatFileMarkdownHref(target: string): string {
  return `${CHAT_FILE_HREF_PREFIX}${encodeURIComponent(target)}`
}

export function chatFileTargetFromMarkdownHref(href?: string): string | null {
  if (!href?.startsWith(CHAT_FILE_HREF_PREFIX)) {
    return null
  }

  try {
    return decodeURIComponent(href.slice(CHAT_FILE_HREF_PREFIX.length))
  } catch {
    return null
  }
}

const EXTERNAL_DOMAIN_HREF_RE =
  /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i

// Streamdown intentionally blocks relative and scheme-less markdown hrefs
// before they reach the component override. Convert files to an inert fragment
// protocol and normalize external domains before Streamdown sanitizes them.
export function rewriteChatMarkdownLinks(text: string): string {
  return text.replace(/(?<!!)\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    if (EXTERNAL_DOMAIN_HREF_RE.test(href)) {
      return `[${label}](https://${href})`
    }

    return isLikelyChatFilePath(href) ? `[${label}](${chatFileMarkdownHref(href)})` : match
  })
}
