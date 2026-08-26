import { Icon as IconifyIcon } from '@iconify/react'
import { useEffect, useMemo, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { readDesktopFileDataUrl, selectDesktopPaths } from '@/lib/desktop-fs'
import { PROFILE_SWATCHES } from '@/lib/profile-color'
import { cn } from '@/lib/utils'

// Curated codicons for a project glyph (tinted by the chosen color). Shared by
// the kebab's Appearance popover and the right-click menu's Appearance submenu
// so both offer the same picker. Iconify search extends this list without
// removing the fast local defaults.
export const PROJECT_ICONS = [
  'folder-library',
  'repo',
  'rocket',
  'beaker',
  'flame',
  'star-full',
  'heart',
  'zap',
  'target',
  'lightbulb',
  'tools',
  'device-desktop',
  'device-mobile',
  'terminal',
  'dashboard',
  'globe',
  'broadcast',
  'cloud',
  'database',
  'package',
  'book',
  'organization',
  'bug',
  'shield',
  'key',
  'gift',
  'telescope',
  'home'
]

const ICONIFY_PREFIX = 'iconify:'
const DEFAULT_ICON_CACHE = new Map<string, Promise<null | string>>()

const DEFAULT_ICON_PATHS = [
  'favicon.svg',
  'favicon.png',
  'favicon.ico',
  'icon.svg',
  'icon.png',
  'logo.svg',
  'logo.png',
  'public/favicon.svg',
  'public/favicon.png',
  'public/favicon.ico',
  'public/icon.svg',
  'public/icon.png',
  'public/logo.svg',
  'public/logo.png',
  'public/apple-touch-icon.png',
  'static/favicon.svg',
  'static/favicon.png',
  'static/favicon.ico',
  'assets/favicon.svg',
  'assets/favicon.png',
  'src/favicon.svg',
  'src/favicon.png',
  'src/app/favicon.ico',
  'app/favicon.ico'
]

interface ProjectAppearancePickerProps {
  color: null | string
  icon: null | string
  noColorLabel: string
  onColor: (color: null | string) => void
  onIcon: (icon: null | string) => void
  projectPath?: null | string
}

interface ProjectIconGlyphProps {
  color?: null | string
  icon?: null | string
  isNoProject?: boolean
  path?: null | string
  size?: string
}

function iconifyValue(name: string): string {
  return `${ICONIFY_PREFIX}${name}`
}

function iconifyName(value: null | string | undefined): null | string {
  return value?.startsWith(ICONIFY_PREFIX) ? value.slice(ICONIFY_PREFIX.length) : null
}

function isImageIcon(value: null | string | undefined): value is string {
  return Boolean(value?.startsWith('data:image/'))
}

function pathJoin(root: string, rel: string): string {
  const slash = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const base = root.replace(/[\\/]+$/, '')

  return `${base}${slash}${rel.replace(/\//g, slash)}`
}

async function resolveDefaultProjectIcon(root: string): Promise<null | string> {
  const key = root.trim()

  if (!key) {
    return null
  }

  if (!DEFAULT_ICON_CACHE.has(key)) {
    DEFAULT_ICON_CACHE.set(
      key,
      (async () => {
        for (const rel of DEFAULT_ICON_PATHS) {
          try {
            const dataUrl = await readDesktopFileDataUrl(pathJoin(key, rel))

            if (isImageIcon(dataUrl)) {
              return dataUrl
            }
          } catch {
            // Missing candidates are expected; keep walking the ladder.
          }
        }

        return null
      })()
    )
  }

  return DEFAULT_ICON_CACHE.get(key) ?? null
}

function useDefaultProjectIcon(path: null | string | undefined, enabled: boolean): null | string {
  const [icon, setIcon] = useState<null | string>(null)
  const key = path?.trim() || ''

  useEffect(() => {
    let live = true

    if (!enabled || !key) {
      setIcon(null)

      return () => {
        live = false
      }
    }

    void resolveDefaultProjectIcon(key).then(result => {
      if (live) {
        setIcon(result)
      }
    })

    return () => {
      live = false
    }
  }, [enabled, key])

  return icon
}

export function ProjectIconGlyph({ color, icon, isNoProject = false, path, size = '0.875rem' }: ProjectIconGlyphProps) {
  const defaultIcon = useDefaultProjectIcon(path, !icon && !isNoProject)
  const effectiveIcon = icon || defaultIcon
  const iconify = iconifyName(effectiveIcon)

  if (isImageIcon(effectiveIcon)) {
    return <img alt="" className="size-full rounded-[0.2rem] object-contain" src={effectiveIcon} />
  }

  if (iconify) {
    return <IconifyIcon aria-hidden="true" height={size} icon={iconify} width={size} />
  }

  if (color && !effectiveIcon) {
    return <span aria-hidden="true" className="size-1 rounded-full" style={{ backgroundColor: color }} />
  }

  return <Codicon name={effectiveIcon || (isNoProject ? 'home' : 'folder-library')} size={size} />
}

function IconPreview({
  color,
  icon,
  name,
  onSelect,
  selected
}: {
  color: null | string
  icon: string
  name: string
  onSelect: () => void
  selected: boolean
}) {
  const iconify = iconifyName(icon)

  return (
    <Tip label={name}>
      <button
        aria-label={name}
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md text-(--ui-text-tertiary) transition hover:bg-(--ui-control-hover-background) hover:text-foreground',
          selected && 'bg-(--ui-control-active-background) text-foreground ring-1 ring-current'
        )}
        onClick={onSelect}
        style={selected && color ? { color } : undefined}
        type="button"
      >
        {iconify ? (
          <IconifyIcon aria-hidden="true" height="0.9375rem" icon={iconify} width="0.9375rem" />
        ) : (
          <Codicon name={icon} size="0.8125rem" />
        )}
      </button>
    </Tip>
  )
}

function CompactColorSwatches({
  clearLabel,
  onChange,
  swatches,
  value
}: {
  clearLabel: string
  onChange: (color: null | string) => void
  swatches: readonly string[]
  value: null | string
}) {
  return (
    <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] items-center gap-1">
      {swatches.map(swatch => (
        <Tip key={swatch} label={swatch}>
          <button
            aria-label={swatch}
            className={cn(
              'size-4 rounded-full transition hover:scale-110',
              swatch === value && 'ring-2 ring-current ring-offset-1 ring-offset-(--ui-bg-elevated)'
            )}
            onClick={() => onChange(swatch)}
            style={{ backgroundColor: swatch, color: swatch }}
            type="button"
          />
        </Tip>
      ))}
      <Tip label={clearLabel}>
        <button
          aria-label={clearLabel}
          className="grid size-5 place-items-center rounded-md text-(--ui-text-tertiary) transition hover:bg-(--ui-control-hover-background) hover:text-foreground"
          onClick={() => onChange(null)}
          type="button"
        >
          <Codicon name="circle-slash" size="0.75rem" />
        </button>
      </Tip>
    </div>
  )
}

/** Color swatches + icon/file/Iconify picker for a project's appearance — one
 *  component so the kebab popover and the right-click submenu render an
 *  identical picker. */
export function ProjectAppearancePicker({
  color,
  icon,
  noColorLabel,
  onColor,
  onIcon,
  projectPath
}: ProjectAppearancePickerProps) {
  const [query, setQuery] = useState('')
  const [iconifyResults, setIconifyResults] = useState<string[]>([])
  const [iconifyBusy, setIconifyBusy] = useState(false)
  const [fileError, setFileError] = useState<null | string>(null)
  const trimmedQuery = query.trim()

  useEffect(() => {
    let live = true

    if (trimmedQuery.length < 2) {
      setIconifyResults([])
      setIconifyBusy(false)

      return () => {
        live = false
      }
    }

    setIconifyBusy(true)

    const timeout = window.setTimeout(() => {
      void fetch(`https://api.iconify.design/search?query=${encodeURIComponent(trimmedQuery)}&limit=48`, {
        headers: { Accept: 'application/json' }
      })
        .then(res => (res.ok ? res.json() : null))
        .then((payload: unknown) => {
          if (!live) {
            return
          }

          const icons =
            payload && typeof payload === 'object' && Array.isArray((payload as { icons?: unknown }).icons)
              ? (payload as { icons: unknown[] }).icons.filter((item): item is string => typeof item === 'string')
              : []

          setIconifyResults(icons)
        })
        .catch(() => {
          if (live) {
            setIconifyResults([])
          }
        })
        .finally(() => {
          if (live) {
            setIconifyBusy(false)
          }
        })
    }, 220)

    return () => {
      live = false
      window.clearTimeout(timeout)
    }
  }, [trimmedQuery])

  const visibleCodicons = useMemo(() => {
    const q = trimmedQuery.toLowerCase()

    return q ? PROJECT_ICONS.filter(name => name.toLowerCase().includes(q)) : PROJECT_ICONS
  }, [trimmedQuery])

  const chooseImageFile = async () => {
    setFileError(null)

    try {
      const [path] = await selectDesktopPaths({
        filters: [{ extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'], name: 'Images and icons' }],
        multiple: false,
        title: 'Choose project icon'
      })

      if (!path) {
        return
      }

      const dataUrl = await readDesktopFileDataUrl(path)

      if (!isImageIcon(dataUrl)) {
        setFileError('That file did not load as an image.')

        return
      }

      onIcon(dataUrl)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Could not load that image.')
    }
  }

  return (
    <div className="w-64 space-y-2" data-project-icon-picker>
      <CompactColorSwatches clearLabel={noColorLabel} onChange={onColor} swatches={PROFILE_SWATCHES} value={color ?? null} />
      <div className="grid grid-cols-2 gap-1.5">
        <button
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/35 px-2 text-[0.6875rem] text-(--ui-text-tertiary) transition hover:bg-(--ui-control-hover-background) hover:text-foreground"
          onClick={() => onIcon(null)}
          title={projectPath ? 'Reset to favicon/default' : 'Reset to default icon'}
          type="button"
        >
          <Codicon name="refresh" size="0.72rem" />
          <span>{projectPath ? 'Use default' : 'Reset'}</span>
        </button>
        <button
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/35 px-2 text-[0.6875rem] text-(--ui-text-tertiary) transition hover:bg-(--ui-control-hover-background) hover:text-foreground"
          onClick={() => void chooseImageFile()}
          type="button"
        >
          <Codicon name="file-media" size="0.72rem" />
          <span>File…</span>
        </button>
      </div>
      {fileError && <div className="px-1 text-[0.625rem] text-(--ui-danger)">{fileError}</div>}
      <label className="flex h-8 items-center gap-1.5 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/35 px-2 text-(--ui-text-tertiary) focus-within:border-(--ui-accent) focus-within:text-foreground">
        <Codicon name="search" size="0.75rem" />
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="min-w-0 flex-1 bg-transparent text-xs leading-none text-foreground outline-none placeholder:text-(--ui-text-quaternary)"
          onChange={event => setQuery(event.target.value)}
          placeholder="Search Iconify…"
          spellCheck={false}
          value={query}
        />
      </label>
      {trimmedQuery.length >= 2 && (
        <div className="text-[0.625rem] text-(--ui-text-tertiary)">
          {iconifyBusy ? 'Searching Iconify…' : iconifyResults.length ? 'Iconify results' : 'No Iconify results'}
        </div>
      )}
      {iconifyResults.length > 0 && (
        <div className="grid max-h-36 grid-cols-8 gap-1 overflow-y-auto pr-1">
          {iconifyResults.map(name => {
            const value = iconifyValue(name)

            return (
              <IconPreview
                color={color}
                icon={value}
                key={name}
                name={name}
                onSelect={() => onIcon(icon === value ? null : value)}
                selected={icon === value}
              />
            )
          })}
        </div>
      )}
      <div className="grid grid-cols-8 gap-1">
        {visibleCodicons.map(name => (
          <IconPreview
            color={color}
            icon={name}
            key={name}
            name={name}
            onSelect={() => onIcon(icon === name ? null : name)}
            selected={icon === name}
          />
        ))}
      </div>
    </div>
  )
}
