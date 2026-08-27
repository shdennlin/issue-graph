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
// Persistence:
//   - View state + viewport are written to localStorage on every snapshotTab
//     call. Page refresh, browser close, etc. preserve "where each tab was."
//   - Graph data is NOT persisted. Refresh always re-fetches from backend so
//     freshness is predictable and we don't have to version the graph
//     payload schema in localStorage. The trade is a brief loading flash on
//     first visit to each tab after refresh.
//
// What gets snapshotted: the IDE-feel state — filters, focus, chain,
// selection, expanded buckets. NOT global preferences (theme, density, font
// size, modal-open flags, `inlineSearch`) — those are
// user-level preferences that should not vary by tab.

import type { Viewport } from 'reactflow'
import type { GraphResponse } from '@shared/types.js'
import { useGraphStore } from './graphStore'
import { defaultFilters, useViewStore, type Filters, type ViewId } from './viewStore'

interface PerTabView {
  activeView: ViewId
  mixGroupBy: string | null
  filters: Filters
  focusedId: string | null
  chainRootIds: string[]
  chainDepthUp: number | null
  chainDepthDown: number | null
  layoutBump: number
  expandedBuckets: string[]
  search: string
  showRelated: boolean
  showHierarchy: boolean
  selection: string[]
  highlightedEdgeId: string | null
  highlightedNodeId: string | null
  /** Which saved view this tab is on. Snapshotted with the rest of the
   *  per-tab state so a tab keeps its identity across switches. */
  appliedSavedViewId: number | null
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
  mixGroupBy: null,
  filters: defaultFilters,
  focusedId: null,
  chainRootIds: [],
  chainDepthUp: null,
  chainDepthDown: null,
  layoutBump: 0,
  expandedBuckets: [],
  search: '',
  showRelated: false,
  showHierarchy: false,
  selection: [],
  highlightedEdgeId: null,
  highlightedNodeId: null,
  appliedSavedViewId: null,
}

const snapshots: Map<string, TabSnapshot> = new Map()

// ─── localStorage persistence ────────────────────────────────────────────
// Stored shape: { version, snapshots: { [tabId]: { view, viewport } } }.
// Graph data is intentionally excluded — see file header for rationale.
// Bump STORAGE_VERSION when PerTabView's shape changes incompatibly; the
// hydrate path discards mismatched data instead of trying to migrate.

const STORAGE_KEY = 'issue-graph-tab-snapshots'
// v2: PerTabView.chainRootId (string|null) → chainRootIds (string[]).
// v3: added chainDepthUp / chainDepthDown.
const STORAGE_VERSION = 3

interface PersistedSnapshot {
  view: PerTabView
  viewport: Viewport | null
}

interface PersistedPayload {
  version: number
  snapshots: Record<string, PersistedSnapshot>
}

function persist(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: PersistedPayload = {
      version: STORAGE_VERSION,
      snapshots: Object.fromEntries(
        [...snapshots.entries()].map(([id, snap]) => [
          id,
          { view: snap.view, viewport: snap.viewport },
        ]),
      ),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota / private mode — degrade silently. In-memory snapshots still
    // work for the current session.
  }
}

function hydrate(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<PersistedPayload>
    if (parsed.version !== STORAGE_VERSION) {
      // Schema mismatch — wipe and start clean.
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    if (!parsed.snapshots || typeof parsed.snapshots !== 'object') return
    for (const [id, snap] of Object.entries(parsed.snapshots)) {
      if (!snap || typeof snap !== 'object') continue
      // Defensive: ensure required shape — drop entries that look corrupt.
      if (typeof snap.view !== 'object' || snap.view === null) continue
      snapshots.set(id, {
        // Merge over defaults rather than trusting the stored shape: filter
        // fields added after a payload was written would otherwise restore as
        // undefined and blow up the filter UI's `filters.x[key]` reads. A
        // STORAGE_VERSION bump would also fix it, but at the cost of wiping
        // every tab's state for a purely additive change.
        // restoreTab does useViewStore.setState(view), a shallow merge — a key
        // missing from an older payload would leave the *current* tab's value
        // in place, leaking one tab's grouping into another. Default it here.
        view: {
          ...snap.view,
          mixGroupBy: snap.view.mixGroupBy ?? null,
          filters: { ...defaultFilters, ...snap.view.filters },
        },
        viewport: snap.viewport ?? null,
        graph: null, // graph is always re-fetched, never restored from disk
      })
    }
  } catch {
    // Corrupt JSON — drop the whole payload rather than partial-restore
    // unpredictable state.
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}

// Hydrate at module load — synchronous so the first loadTab() call
// already sees persisted snapshots.
hydrate()

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
    mixGroupBy: v.mixGroupBy,
    filters: v.filters,
    focusedId: v.focusedId,
    chainRootIds: v.chainRootIds,
    chainDepthUp: v.chainDepthUp,
    chainDepthDown: v.chainDepthDown,
    layoutBump: v.layoutBump,
    expandedBuckets: v.expandedBuckets,
    search: v.search,
    showRelated: v.showRelated,
    showHierarchy: v.showHierarchy,
    selection: v.selection,
    highlightedEdgeId: v.highlightedEdgeId,
    highlightedNodeId: v.highlightedNodeId,
    appliedSavedViewId: v.appliedSavedViewId,
  }
}

/** Save a tab's view + viewport + graph for later restoration, keyed by tab id. */
export function snapshotTab(tabId: string): void {
  snapshots.set(tabId, {
    view: captureCurrentView(),
    viewport: viewportGetter?.() ?? null,
    graph: useGraphStore.getState().graph,
  })
  persist()
}

/**
 * Apply a tab's saved state to the live stores, or — if no snapshot
 * exists — reset both stores to defaults so the new tab starts fresh.
 *
 * Returns true ONLY when graph data was restored from in-memory cache (an
 * earlier `snapshotTab` call in the same session) — caller should then do
 * a silent background refresh. Returns false in two cases:
 *   - cold start (no snapshot at all) → caller does a full `loadGraph()`.
 *   - view-only restore (snapshot hydrated from localStorage on page
 *     refresh, where view state survives but graph data was intentionally
 *     not persisted) → caller does a full `loadGraph()` so the loading
 *     state shows during the fetch instead of a misleading empty canvas.
 *
 * Either way, the view store is populated correctly before this returns.
 */
export function loadTab(tabId: string): boolean {
  const snap = snapshots.get(tabId)
  if (snap) {
    useViewStore.setState(snap.view)
    if (snap.graph) {
      useGraphStore.setState({
        graph: snap.graph,
        status: 'idle',
        error: null,
        syncing: false,
      })
    } else {
      // View-only restore (e.g. hydrated from localStorage after page
      // refresh). Mark loading so the UI shows a spinner during the fetch
      // the caller will issue, instead of a blank-canvas false-empty.
      useGraphStore.setState({
        graph: null,
        status: 'loading',
        error: null,
        syncing: false,
      })
    }
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
    return snap.graph !== null
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

/**
 * Apply ONLY the viewport portion of a tab's snapshot. Used on initial
 * page mount, where view state (filters, focus, etc.) is already populated
 * by URL parsing — the URL is the share-able source of truth and must
 * win over the snapshot. Viewport doesn't live in the URL though, so this
 * is the one piece of per-tab state that needs separate restoration on
 * page reload.
 */
export function restoreViewportOnly(tabId: string): void {
  const snap = snapshots.get(tabId)
  if (snap?.viewport && viewportRestoreCallback) {
    viewportRestoreCallback(snap.viewport)
  }
}

/**
 * Read a tab's last active view WITHOUT applying the rest of its snapshot.
 * Used on a fresh focus-deep-link load (Raycast / shared URL): the URL pins the
 * issue but carries no `?view=`, so we restore the view the user was last in
 * while the URL stays authoritative for focus/filters. Returns null when the
 * tab has no snapshot yet. Mirrors restoreViewportOnly's "URL wins, but this one
 * piece isn't in the URL" rationale — just for the view instead of the viewport.
 */
/** Which saved view another tab is on, without switching to it. Lets the tab
 *  bar label every tab rather than only the active one. */
export function peekTabSavedViewId(tabId: string): number | null {
  return snapshots.get(tabId)?.view.appliedSavedViewId ?? null
}

export function peekTabView(tabId: string): ViewId | null {
  return snapshots.get(tabId)?.view.activeView ?? null
}

/** Forget a tab's snapshot (called on tab close). */
export function forgetTab(tabId: string): void {
  snapshots.delete(tabId)
  persist()
}

export function clearAllTabSnapshots(): void {
  snapshots.clear()
  persist()
}

/** Read a tab's snapshotted graph. Returns null for the active tab
 *  (its graph lives in useGraphStore) and for tabs the user hasn't
 *  visited yet in this session. Callers should fall back accordingly. */
export function getTabGraph(tabId: string): import('@shared/types.js').GraphResponse | null {
  return snapshots.get(tabId)?.graph ?? null
}
