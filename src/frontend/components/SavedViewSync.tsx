// App-level saved-view housekeeping: fetch the list, work out which view this
// tab is on, and keep the window title in step. Renders nothing.
//
// These three effects used to live in SavedViewsChip, which was wrong in a way
// that only showed up once the filter panel learned to auto-hide: collapsed,
// FacetBar returns a handle and never mounts the chip, so on a cold start with
// the panel unpinned the list was never fetched. The tab strip labels every tab
// with its saved view's NAME (TabBar reads the id from each tab's snapshot and
// looks the name up in this list), so an unfetched list means unlabelled tabs
// and a bare window title until the user happened to hover the panel open.
//
// The rule the bug taught: an effect whose reach is the whole app must not live
// in a component the layout is free to unmount. Hence a leaf mounted from App.
//
// It stays a leaf rather than moving into App's own body because
// useActiveSavedView subscribes to the entire view store; re-rendering the app
// root on every hover and highlight would defeat the hand-written memoization
// in GraphCanvas and useFilterCounts.

import { useEffect } from 'react'
import { useSavedViewsStore } from '../store/savedViewsStore'
import { useViewStore } from '../store/viewStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useActiveSavedView } from '../hooks/useActiveSavedView'
import { documentTitle } from '../lib/savedViewMatch'

/** The app name as index.html shipped it, captured once at module load.
 *  Read per-component it would re-capture a title this code had already
 *  rewritten, and each remount would nest another segment. */
const BASE_TITLE = typeof document === 'undefined' ? '' : document.title

export function SavedViewSync(): null {
  const load = useSavedViewsStore((s) => s.load)
  const status = useSavedViewsStore((s) => s.status)
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const profiles = useWorkspaceStore((s) => s.profiles)
  const appliedId = useViewStore((s) => s.appliedSavedViewId)
  const setAppliedId = useViewStore((s) => s.setAppliedSavedViewId)
  const { view: current, dirty } = useActiveSavedView()

  // Views are per workspace (each has its own graph.db), so refetch on switch.
  useEffect(() => {
    if (workspaceId) void load()
  }, [workspaceId, load])

  // A failed load used to be permanent: nothing retried it, so a fetch that
  // lost the network — the machine waking from sleep is the reliable way to
  // arrange that — left the list empty until a reload or a workspace switch.
  //
  // `online` is the load-bearing listener, not `focus`: the failure case is a
  // tab that reloads DURING the wake, so the window is already focused and
  // visible when the fetch fails and neither of the other two will ever fire.
  // They cover the other half — the tab that was in the background while the
  // network came back, where `online` fired before this effect was listening.
  useEffect(() => {
    if (status !== 'error' || !workspaceId) return
    const retry = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('online', retry)
    window.addEventListener('focus', retry)
    document.addEventListener('visibilitychange', retry)
    return () => {
      window.removeEventListener('online', retry)
      window.removeEventListener('focus', retry)
      document.removeEventListener('visibilitychange', retry)
    }
  }, [status, workspaceId, load])

  // Adopt an exact match as the reference point, so edits made after arriving
  // on a shared link that equals a saved view still show as divergence.
  useEffect(() => {
    if (current && !dirty && current.id !== appliedId) setAppliedId(current.id)
  }, [current, dirty, appliedId, setAppliedId])

  // Only named when there is more than one workspace — repeating the sole
  // workspace's name on every window distinguishes nothing.
  const workspaceName =
    profiles.length > 1 ? (profiles.find((p) => p.id === workspaceId)?.name ?? null) : null
  useEffect(() => {
    document.title = documentTitle(current, dirty, workspaceName, BASE_TITLE)
  }, [current, dirty, workspaceName])

  return null
}
