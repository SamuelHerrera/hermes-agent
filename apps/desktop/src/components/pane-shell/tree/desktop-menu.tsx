import type { MenuKit } from '@/components/ui/actions-menu'
import { renderActionItem } from '@/components/ui/actions-menu'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { isSecondaryWindow } from '@/store/windows'

import { tabbedScreenOwner } from './screens'
import {
  $layoutSurfaceMode,
  $scrollWindowWorkspaces,
  moveScrollWindowToWorkspace,
  SCROLL_WINDOW_WORKSPACE_IDS
} from './scroll-windows/store'
import { isMainStripPane, moveTreePanesToTabbedScreen } from './store'

interface PaneDesktopMenuProps {
  kit: MenuKit
  paneId: string
}

/** Shared by session tabs, generic zones and scroll headers. Mounted on menu open. */
export function PaneDesktopMenu({ kit, paneId }: PaneDesktopMenuProps) {
  const { t } = useI18n()
  const scrolling = $layoutSurfaceMode.get() === 'scroll-windows'

  const owner = scrolling
    ? $scrollWindowWorkspaces.get().find(workspace => workspace.windowIds.includes(paneId))?.id
    : tabbedScreenOwner(paneId)

  if (isSecondaryWindow() || !isMainStripPane(paneId)) {
    return null
  }

  return (
    <kit.Sub>
      <kit.SubTrigger>
        <Codicon name="window" size="0.875rem" />
        <span>{t.zones.moveToScreen}</span>
      </kit.SubTrigger>
      <kit.SubContent>
        {SCROLL_WINDOW_WORKSPACE_IDS.map(id => renderActionItem(kit, {
          disabled: id === owner,
          key: id,
          label: t.zones.screenNumber(id),
          onSelect: () => scrolling
            ? moveScrollWindowToWorkspace(paneId, id)
            : moveTreePanesToTabbedScreen([paneId], id, paneId)
        }))}
      </kit.SubContent>
    </kit.Sub>
  )
}
