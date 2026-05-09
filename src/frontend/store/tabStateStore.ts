// Per-tab UI state cache for the in-app tab bar. Each visible tab is a
// "view session" — it can be on any workspace, and two tabs may share a
// workspace while keeping different filters/focus. Snapshots are keyed by
// **tab id** (not workspace id) so duplicate-workspace tabs stay independent.
//
// Switching tabs feels instant because we snapshot the current view + graph
// before the switch and restore the target's snapshot when one exists. On a
// first-time visit (no snapshot) both stores reset to defaults so the
// previous tab's state doesn't leak.
//
// What gets snapshotted: the IDE-feel state — filters, focus, chain,
// selection, expanded buckets. NOT global preferences (theme, density, font
// size, modal-open flags, `filterPanelOpen`, `inlineSearch`) — those are
// user-level preferences that should not vary by tab.

import type { Viewport } from 'reactflow'
import type { GraphResponse } from '@shared/types.js'
import { useGraphStore } from './graphStore'
import { defaultFilters, useViewStore, type Filters, type ViewId } from './viewStore'

interface PerTabView {
  activeView: ViewId
  filters: Filters
  focusedId: string | null
  chainRootId: string | null
  layoutBump: number
  expandedBuckets: string[]
  search: string
  showRelated: boolean
  selection: string[]
  highlightedEdgeId: string | null
  highlightedNodeId: string | null
}

interface TabSnapshot {
  view: PerTabView
  /** ReactFlow viewport (pan + zoom) at snapshot time. Lives outside the
   *  view store because it changes 60×/sec during pan and shouldn't churn
   *  zustand subscribers; the bridge below reads it on-demand from RF. */
  viewport: Viewport | null
  graph: GraphResponse | null
}

const defaultView: PerTabView = {
  activeView: 'dependency',
  filters: defaultFilters,
  focusedId: null,
  chainRootId: null,
  layoutBump: 0,
  expandedBuckets: [],
  search: '',
  showRelated: false,
  selection: [],
  highlightedEdgeId: null,
  highlightedNodeId: null,
}

const snapshots: Map<string, TabSnapshot> = new Map()

// Bridge to GraphCanvas. Three callbacks:
//   - getter: snapshotTab reads the live RF viewport before storing.
//   - restoreCallback: loadTab signals a viewport to apply after layout.
//   - postRestoreCallback: loadTab signals "store has been restored, sync
//     any per-tab refs so cross-tab effects don't fire spuriously". This
//     is the fix for refs like lastLayoutBumpRef / prevChainRef in
//     GraphCanvas that compare a remembered value against the live store
//     — without re-syncing, a tab switch looks identical to the user
//     pressing the shortcut that bumps that value.
//
// Without a registered bridge (e.g. the user is on the Settings page when
// snapshotTab fires), capture is null and restore/postRestore are no-ops.
let viewportGetter: (() => Viewport) | null = null
let viewportRestoreCallback: ((vp: Viewport) => void) | null = null
let postRestoreCallback: (() => void) | null = null

export function registerViewportBridge(
  getter: () => Viewport,
  restoreCallback: (vp: Viewport) => void,
  postRestore?: () => void,
): () => void {
  viewportGetter = getter
  viewportRestoreCallback = restoreCallback
  postRestoreCallback = postRestore ?? null
  return () => {
    if (viewportGetter === getter) viewportGetter = null
    if (viewportRestoreCallback === restoreCallback) viewportRestoreCallback = null
    if (postRestoreCallback === (postRestore ?? null)) postRestoreCallback = null
  }
}

function captureCurrentView(): PerTabView {
  const v = useViewStore.getState()
  return {
    activeView: v.activeView,
    filters: v.filters,
    focusedId: v.focusedId,
    chainRootId: v.chainRootId,
    layoutBump: v.layoutBump,
    expandedBuckets: v.expandedBuckets,
    search: v.search,
    showRelated: v.showRelated,
    selection: v.selection,
    highlightedEdgeId: v.highlightedEdgeId,
    highlightedNodeId: v.highlightedNodeId,
  }
}

/** Save a tab's view + viewport + graph for later restoration, keyed by tab id. */
export function snapshotTab(tabId: string): void {
  snapshots.set(tabId, {
    view: captureCurrentView(),
    viewport: viewportGetter?.() ?? null,
    graph: useGraphStore.getState().graph,
  })
}

/**
 * Apply a tab's saved state to the live stores, or — if no snapshot
 * exists — reset both stores to defaults so the new tab starts fresh.
 *
 * Returns true when a real snapshot was restored (graphStore now holds the
 * cached graph and the caller should do a silent background refresh); false
 * means a cold-start that needs a full `loadGraph()`.
 */
export function loadTab(tabId: string): boolean {
  const snap = snapshots.get(tabId)
  if (snap) {
    useViewStore.setState(snap.view)
    useGraphStore.setState({
      graph: snap.graph,
      status: 'idle',
      error: null,
      syncing: false,
    })
    // Restore the user's prior pan + zoom so they land exactly where they
    // left off. Always — including when focused: the only setCenter path
    // (Producer 3 in GraphCanvas) is gated on layoutBump and does not run
    // on tab switch, so there's nothing to conflict with. Without this,
    // returning to a tab where the user clicked an issue (focusedId set)
    // would lose the pan/zoom they had carefully framed.
    if (snap.viewport && viewportRestoreCallback) {
      viewportRestoreCallback(snap.viewport)
    }
    // Sync GraphCanvas's per-tab refs to the just-restored store values
    // so tab-switch state deltas don't masquerade as user actions.
    postRestoreCallback?.()
    return true
  }
  useViewStore.setState(defaultView)
  useGraphStore.setState({
    graph: null,
    status: 'idle',
    error: null,
    syncing: false,
  })
  // Same as the warm-restore branch — sync refs to defaults.
  postRestoreCallback?.()
  return false
}

/** Forget a tab's snapshot (called on tab close). */
export function forgetTab(tabId: string): void {
  snapshots.delete(tabId)
}

export function clearAllTabSnapshots(): void {
  snapshots.clear()
}
