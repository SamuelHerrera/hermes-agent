import { Codicon } from '@/components/ui/codicon'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import type { Contribution } from '@/contrib/types'

import type { SidebarNavContribution } from '../../routes'
import type { SidebarNavItem } from '../../types'

/**
 * Convert `sidebar.nav` plugin data contributions into the app's own nav row
 * shape. If a contribution also provides a render callback, mount it as the
 * row's right-side adornment so plugin pages can surface live badges/spinners
 * without reimplementing the whole sidebar button.
 */
export function contributedNavItems(navContributions: readonly Contribution[]): SidebarNavItem[] {
  return navContributions.flatMap(c => {
    const data = c.data as Partial<SidebarNavContribution> | undefined

    if (!data?.path?.startsWith('/') || !data.label) {
      return []
    }

    const codicon = data.codicon || 'plug'
    const renderAdornment = c.render

    return [
      {
        id: c.id,
        label: data.label,
        icon: (props: { className?: string }) => <Codicon name={codicon} {...props} />,
        route: data.path,
        adornment: renderAdornment
          ? function SidebarNavContributionAdornment() {
              return (
                <ContribBoundary id={c.id} variant="chip">
                  <ContribRender render={renderAdornment} />
                </ContribBoundary>
              )
            }
          : undefined
      }
    ]
  })
}