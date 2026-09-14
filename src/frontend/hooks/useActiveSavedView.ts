// "Which saved view am I on, and have I edited away from it?" — for every
// consumer, not just the views menu.
//
// Extracted because the answer now has three consumers with different
// lifetimes: the menu itself, the collapsed filter handle, and SavedViewSync
// (which owns the window title). Recomputing it in each is cheap — it is a
// string compare over a handful of rows — and far safer than lifting it into a
// store, which would need invalidating on every change urlSync can serialize.
//
// Deliberately a leaf-only hook. It subscribes to the WHOLE view store, since
// currentQuery() serializes view, chain, related, hierarchy and mixby as well
// as the filters, and any of them changing changes the answer. Calling it from
// a component with children would re-render that subtree on every hover and
// highlight — exactly the manual memoization CLAUDE.md warns is load-bearing
// here. Call it from components that render no children.

import { useSavedViewsStore } from '../store/savedViewsStore'
import { useViewStore } from '../store/viewStore'
import { currentQuery } from '../store/urlSync'
import { savedViewStatus, type SavedViewStatus } from '../lib/savedViewMatch'
import type { SavedViewDTO } from '@shared/types.js'

export function useActiveSavedView(): SavedViewStatus<SavedViewDTO> {
  const views = useSavedViewsStore((s) => s.views)
  useViewStore()
  const appliedId = useViewStore((s) => s.appliedSavedViewId)
  return savedViewStatus(currentQuery(), views, appliedId)
}

/** The label both the chip and the collapsed handle show: the view's name,
 *  marked when the current state has diverged from it. Null when no view is in
 *  play, so callers can fall back to their own wording. */
export function activeViewLabel(status: SavedViewStatus<{ name: string }>): string | null {
  return status.view ? `${status.view.name}${status.dirty ? ' *' : ''}` : null
}
