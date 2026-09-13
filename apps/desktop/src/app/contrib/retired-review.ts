import { allPaneIds } from '@/components/pane-shell/tree/model'
import { $layoutTree, removeTreePane } from '@/components/pane-shell/tree/store'

/** Retire the core pane on boot and whenever a saved screen/layout is restored. */
export function watchRetiredReviewPane(): () => void {
  return $layoutTree.subscribe(tree => {
    if (tree && allPaneIds(tree).includes('review')) {
      removeTreePane('review')
    }
  })
}
