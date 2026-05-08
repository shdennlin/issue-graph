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

/** Save a tab's view + graph for later restoration, keyed by tab id. */
export function snapshotTab(tabId: string): void {
  snapshots.set(tabId, {
    view: captureCurrentView(),
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
    return true
  }
  useViewStore.setState(defaultView)
  useGraphStore.setState({
    graph: null,
    status: 'idle',
    error: null,
    syncing: false,
  })
  return false
}

/** Forget a tab's snapshot (called on tab close). */
export function forgetTab(tabId: string): void {
  snapshots.delete(tabId)
}

export function clearAllTabSnapshots(): void {
  snapshots.clear()
}
