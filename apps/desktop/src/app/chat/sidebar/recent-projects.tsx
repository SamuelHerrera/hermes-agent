import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cleanPath, comparisonPath } from '@/lib/path-compare'
import { $gateway } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import { $projectTree, projectHistory } from '@/store/projects'
import type { ProjectInfo } from '@/types/hermes'

import { ProjectIconGlyph } from './projects/project-appearance'

interface RecentProjectsProps {
  disabled: boolean
  onOpen: () => void
  onBusyChange?: (busy: boolean) => void
}

// Each mount owns only this dialog's snapshot. Changing connection/profile
// remounts the list, so no old history or in-flight result can leak across it.
export function RecentProjects(props: RecentProjectsProps) {
  const profile = useStore($activeGatewayProfile)
  const gateway = useStore($gateway)
  const [source, setSource] = useState({ gateway, profile, generation: 0 })

  if (source.gateway !== gateway || source.profile !== profile) {
    setSource({ gateway, profile, generation: source.generation + 1 })
  }

  return <RecentProjectList key={source.generation} {...props} />
}

function RecentProjectList({ disabled, onOpen, onBusyChange }: RecentProjectsProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const tree = useStore($projectTree)
  const [history, setHistory] = useState<Awaited<ReturnType<typeof projectHistory>> | null>(null)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void projectHistory()
      .then(async api => {
        const rows = await api.list()

        if (live) {
          setHistory(api)
          setProjects(rows)
        }
      })
      .catch(() => {
        if (live) {
          setFailed(true)
        }
      })
      .finally(() => {
        if (live) {
          setLoading(false)
        }
      })

    return () => {
      live = false
    }
  }, [])

  const act = async (id: string, remove: boolean) => {
    if (!history || busy || disabled) {
      return
    }

    setBusy(true)
    onBusyChange?.(true)

    try {
      if (remove) {
        setProjects(await history.forget(id))
      } else {
        await history.open(id)
        onOpen()
      }
    } catch (err) {
      notifyError(err, p.recentFailed)
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  // Sidebar membership, not the currently selected project, defines "open".
  // Saved ids are authoritative; path identity also covers inferred repo rows.
  const visibleProjects = projects.filter(
    project =>
      !tree.some(
        node =>
          !node.archived &&
          !node.isNoProject &&
          (node.id === project.id ||
            ((!node.id.startsWith('p_') || !project.id.startsWith('p_')) &&
              node.path &&
              project.folders.some(
                folder => comparisonPath(cleanPath(folder.path)) === comparisonPath(cleanPath(node.path!))
              )))
      )
  )

  if (loading || (!failed && visibleProjects.length === 0)) {
    return null
  }

  return (
    <section
      aria-label={p.recentTitle}
      className="min-w-0 border-t border-(--stroke-nous) pt-3 min-[800px]:order-first min-[800px]:border-r min-[800px]:border-t-0 min-[800px]:pr-4 min-[800px]:pt-0"
      data-project-recents
    >
      <h3 className="text-[0.75rem] font-medium text-(--ui-text-secondary)">{p.recentTitle}</h3>

      {failed ? (
        <p className="mt-2 text-[0.75rem] text-(--ui-text-tertiary)">{p.recentFailed}</p>
      ) : (
        <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
          {visibleProjects.map(project => (
            <li
              className="flex min-w-0 items-center gap-1 rounded-md hover:bg-(--ui-control-hover-background)"
              key={project.id}
            >
              <button
                aria-label={`${p.openRecent}: ${project.name}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:opacity-50"
                disabled={disabled || busy}
                onClick={() => void act(project.id, false)}
                type="button"
              >
                <span
                  className="flex size-5 shrink-0 items-center justify-center"
                  style={{ color: project.color || undefined }}
                >
                  <ProjectIconGlyph color={project.color} icon={project.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.75rem]" title={project.name}>
                    {project.name}
                  </span>
                  <span
                    className="block truncate text-[0.6875rem] text-(--ui-text-tertiary)"
                    title={project.folders.map(f => f.path).join('\n')}
                  >
                    {project.primary_path || project.folders[0]?.path}
                  </span>
                </span>
              </button>
              <Tip label={`${p.removeRecent}. ${p.recentHint}`}>
                <Button
                  aria-label={`${p.removeRecent}: ${project.name}`}
                  className="mr-1 shrink-0 text-(--ui-text-tertiary)"
                  disabled={disabled || busy}
                  onClick={() => void act(project.id, true)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Codicon name="trash" size="0.75rem" />
                </Button>
              </Tip>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
