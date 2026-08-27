import { create } from 'zustand'
import type { IssueStateType } from '@shared/types.js'
import {
  readDefaultView,
  readStaleDays,
  readTheme,
  writeStaleDays,
  writeTheme,
} from '../lib/preferences'
import type { RecencyMode, RecencyWindow } from '../lib/recency'

export type ViewId = 'dependency' | 'mix' | 'project' | 'milestone' | 'designdoc'
export type Density = 'compact' | 'default' | 'verbose'
export type ThemeMode = 'light' | 'dark' | 'auto'
// Either a preset (sm/md/lg) or a custom base px value (e.g. 14). When a
// number, the hook derives meta/chip/title sizes as base ± offsets.
export type FontSize = 'sm' | 'md' | 'lg' | number

export interface Filters {
  stateTypes: IssueStateType[]
  // Specific Linear state names (e.g. "Review Spec", "Duplicate"). When empty,
  // stateTypes is used as the coarse filter. When non-empty, stateNames takes
  // precedence — only issues whose state.name is in this list pass.
  stateNames: string[]
  activeOnly: boolean
  myIssuesOnly: boolean
  staleOnly: boolean
  primaryValues: string[]   // primary group label ids
  typeValues: string[]      // type group label ids
  priorities: number[]
  assignees: string[]       // assignee display names
  prefixSelections: Record<string, string[]>  // token → label ids
  // Label groups that autodetect did not promote to primary/type
  // (DetectedSchema.otherGroups), keyed by group name → label ids. Same
  // OR-within / AND-across semantics as prefixSelections; kept as a separate
  // map because group names and prefix tokens live in different namespaces
  // and a label can legitimately appear in both.
  groupSelections: Record<string, string[]>
  // Ungrouped labels with no prefix pattern (DetectedSchema.orphans), plus
  // anything else the schema failed to classify. Flat id list — there is no
  // group name to key on.
  orphanValues: string[]
  designdocFilter: 'all' | 'has' | 'missing'
  // Due-date filter:
  //   'any'      — no filter (default)
  //   'has'      — issues that have a dueDate set (regardless of state)
  //   'overdue'  — past due, still actionable (state ∉ completed/canceled)
  //   'soon7'    — due today through today+7, still actionable
  //   'soon30'   — due today through today+30, still actionable
  // Overdue/soon partition the "actionable" set: overdue covers dueDate < today,
  // soon covers today <= dueDate <= today+N. Completed/canceled issues are
  // excluded from overdue/soon (matches the chip-color rule in IssueNode).
  dueFilter: 'any' | 'has' | 'overdue' | 'soon7' | 'soon30'
  // Linear project ids to filter by. Empty = no project filter (show all).
  // The literal string '__noproject' matches issues without a project,
  // mirroring the Project view's grouping convention so the two features
  // stay in sync visually and behaviorally.
  projectIds: string[]
  // Composite milestone keys of the form '<projectId>::<milestoneId>' (or
  // '<projectId>::__nomilestone' for issues that have a project but no
  // milestone within it). Sub-filter of projectIds: when non-empty, takes
  // precedence — projectIds is ignored (mirrors stateNames > stateTypes).
  milestoneIds: string[]
  // Recency filter — the complement of `staleOnly`. `recencyWindow` is the
  // filter value ('any' = off); `recencyMode` picks which timestamp it reads
  // and is a mode selector, not a filter value (leave-one-out counting
  // clears the window but keeps the mode).
  recencyWindow: RecencyWindow
  recencyMode: RecencyMode
  /**
   * Facet ids whose selection is INVERTED — "is not any of" rather than
   * "is any of". Stored as a list of ids rather than a boolean per dimension
   * so a new dimension is negatable for free and the whole thing serializes
   * to one URL param.
   *
   * Only multi-select facets appear here. Negating a boolean quick-filter is a
   * double negative, and negating a single-select enum ("not overdue") is
   * expressible by picking the other values.
   *
   * Inert while the dimension has no values selected: every check is guarded
   * on a non-empty selection, and "not in the empty set" matches everything —
   * i.e. the same as no filter.
   */
  negated: string[]
}

export interface ViewState {
  activeView: ViewId
  filters: Filters
  focusedId: string | null
  // When non-empty, the view filters to the connected component over `blocks`
  // edges (both directions, transitive) rooted at these identifiers — the
  // UNION of each root's chain. Other filters are bypassed while active so the
  // chain doesn't fragment. Single-root is the common case (right-click →
  // "Isolate chain"); multi-root comes from isolating a multi-selection.
  chainRootIds: string[]
  // Chain depth caps (hops from the nearest root). `null` = unbounded, the
  // default — chain mode shows the full connected component. `chainDepthUp`
  // limits blockers (upstream); `chainDepthDown` limits things the roots block
  // (downstream). Only consulted while chainRootIds is non-empty.
  chainDepthUp: number | null
  chainDepthDown: number | null
  // Monotonic counter — bump to force a fresh dagre layout pass even when
  // the layout signature (view/density) hasn't changed. Used by
  // "Isolate chain (re-arrange)" so the new chain lays out cleanly instead
  // of inheriting whatever positions the user had dragged before.
  layoutBump: number
  expandedBuckets: string[]
  theme: ThemeMode
  density: Density
  fontSize: FontSize
  /** Max issues per row inside a container. localStorage-backed so each
   *  user can tune for their screen (Stage Manager → 4, ultrawide → 6+). */
  maxColsPerRow: number
  // Which label dimension the Mix view buckets by. null = auto (the detected
  // primary group), which is the historical behavior. Encoding and the
  // stale-key fallback live in lib/mixGrouping.ts.
  mixGroupBy: string | null
  search: string                 // toolbar filter search (narrows visible set)
  inlineSearch: { open: boolean; query: string; activeIdx: number }
  settingsOpen: boolean
  syncHistoryOpen: boolean
  coverageOpen: boolean
  shortcutsOpen: boolean
  // Workspace notes modal. `notesOpen` controls the modal; `focusedNoteId`
  // null → grid view, number → editor view for that note.
  notesOpen: boolean
  focusedNoteId: number | null
  /** True while the in-note find bar (Cmd+F inside NoteEditor) is open.
   *  NotesModal's window-level Esc handler checks this so the find bar
   *  can swallow Esc first; the modal stays open until find bar dismisses. */
  noteFindOpen: boolean
  // Monotonic counter — bump to ask GraphCanvas to pan/zoom onto the currently
  // focused issue. Useful when an external producer (e.g. a click on an issue
  // link inside a note) wants the camera to follow the focus change.
  panToFocusedSeq: number
  // Monotonic counter — bumped when a focus deep link arrives (Raycast / direct
  // URL) and we KEEP the current view instead of resetting to dependency. The
  // camera no longer moves as a side effect of a view switch, so GraphCanvas
  // listens to this to queue a preserve-focus fit onto the arriving issue.
  focusArrivalSeq: number
  // True between a view-preserving focus deep link and the moment GraphCanvas
  // confirms the issue actually has a node in the kept view. If it doesn't
  // (e.g. focusing a project-less issue while in Milestone view), GraphCanvas
  // falls back to dependency — which shows every issue — so the camera never
  // lands on emptiness. One-shot: cleared as soon as it's resolved.
  deepLinkFocusFallbackArmed: boolean
  // When true, dependency view also draws `related` relations as dashed
  // edges (in addition to the always-on `blocks` edges). Off by default so
  // the dependency view stays focused on the dependency signal — turn on
  // when you want the wider context of "what's related but not blocking".
  showRelated: boolean
  // When true, dependency view draws Linear's parent/child links as edges and
  // chain mode pulls each member's 1-hop parent/children in. Off by default:
  // most workspaces use sub-issues lightly, and hierarchy is not a dependency
  // — mixing it into the default view dilutes "an arrow means it blocks you".
  showHierarchy: boolean
  selection: string[] // multi-select identifiers
  highlightedEdgeId: string | null // when set, the edge + its endpoints stay opaque, others dim
  highlightedNodeId: string | null // when set, the node + its connected edges/neighbors stay opaque
  contextMenu: { x: number; y: number; targetIdentifier: string } | null
  staleDays: number
  /**
   * The saved view this tab is on — the reference point for "you have since
   * edited it". Per-tab rather than global: each tab carries its own filters,
   * so each is on its own view, and a single shared value could only ever
   * describe whichever tab happened to be active.
   */
  appliedSavedViewId: number | null
  setAppliedSavedViewId: (id: number | null) => void
  /**
   * How many issue cards the canvas is actually drawing, published by
   * GraphCanvas because it is the only place that knows: container views add
   * nodes that are not issues, and chain isolation cuts the set down further,
   * so "issues matching the filters" and "cards on screen" are different
   * numbers. Derived, so deliberately NOT part of the per-tab snapshot.
   */
  visibleIssueCount: number | null
  setVisibleIssueCount: (n: number | null) => void
  /**
   * Whether the filter panel stays open. Unpinned it collapses to a handle
   * and expands on hover, giving the graph the corner back.
   *
   * Per-browser preference, like theme and density — not per tab and not in
   * the URL, so opening someone's shared link never rearranges your chrome.
   * Defaults to pinned: this changes how the app behaves, so it should be
   * opted into rather than sprung on anyone who updates.
   */
  filterPanelPinned: boolean
  toggleFilterPanelPinned: () => void
  // Session panel visibility. The persistent preference is
  // `detailPanelAutoOpen` below; that flag decides whether selecting a new
  // issue *automatically* opens the panel. detailPanelOpen tracks the actual
  // current visibility — sticky across focus changes once the user opens it
  // ad-hoc (Space/Enter/'d'), so subsequent focus switches keep showing the
  // detail. Esc, clearing focus, or pressing 'd' again resets it to false.
  detailPanelOpen: boolean
  /**
   * Project detail panel — sister to detailPanelOpen but for projects. The
   * two panels are mutually exclusive (open one → other closes) since they
   * share the right-edge real estate. focusedProjectId is the project id
   * (Linear UUID) currently showing in the panel, independent of focusedId
   * which tracks the issue selection.
   */
  focusedProjectId: string | null
  /**
   * When the user clicks a milestone container in milestone view, this carries
   * the milestone id through to ProjectPanel so it can scroll to + open that
   * milestone's <details>. One-shot: ProjectPanel clears it after applying so
   * subsequent panel re-opens don't auto-expand stale focus.
   */
  focusedMilestoneId: string | null
  projectPanelOpen: boolean

  setActiveView: (v: ViewId) => void
  setFilter: <K extends keyof Filters>(k: K, v: Filters[K]) => void
  toggleStateType: (t: IssueStateType) => void
  toggleStateName: (name: string) => void
  togglePrimary: (id: string) => void
  toggleType: (id: string) => void
  togglePriority: (p: number) => void
  toggleAssignee: (name: string) => void
  togglePrefix: (token: string, id: string) => void
  toggleGroupLabel: (group: string, id: string) => void
  toggleOrphan: (id: string) => void
  toggleProject: (id: string) => void
  toggleMilestone: (compositeKey: string) => void
  setFocusedId: (id: string | null) => void
  /** Convenience for the single-root path: `null` clears, an id sets `[id]`. */
  setChainRootId: (id: string | null) => void
  /** Set the full root set (multi-select → isolate). Empty clears chain mode. */
  setChainRootIds: (ids: string[]) => void
  /** Set upstream (blockers) chain depth cap. `null` = unbounded. */
  setChainDepthUp: (depth: number | null) => void
  /** Set downstream (dependents) chain depth cap. `null` = unbounded. */
  setChainDepthDown: (depth: number | null) => void
  bumpLayout: () => void
  setTheme: (t: ThemeMode) => void
  setDensity: (d: Density) => void
  setFontSize: (f: FontSize) => void
  setMaxColsPerRow: (n: number) => void
  setMixGroupBy: (key: string | null) => void
  setSearch: (q: string) => void
  openInlineSearch: () => void
  closeInlineSearch: () => void
  setInlineSearchQuery: (q: string) => void
  setInlineSearchActiveIdx: (i: number) => void
  setSettingsOpen: (b: boolean) => void
  setSyncHistoryOpen: (b: boolean) => void
  setCoverageOpen: (b: boolean) => void
  setShortcutsOpen: (b: boolean) => void
  setNotesOpen: (b: boolean) => void
  setFocusedNoteId: (id: number | null) => void
  setNoteFindOpen: (b: boolean) => void
  requestPanToFocused: () => void
  /** Signal a view-preserving focus deep link: bump focusArrivalSeq so the
   *  camera follows, and arm the fallback when we kept a non-dependency view. */
  notifyDeepLinkFocus: (armed: boolean) => void
  clearDeepLinkFocusFallback: () => void
  setShowRelated: (b: boolean) => void
  setShowHierarchy: (b: boolean) => void
  setSelection: (s: string[]) => void
  toggleSelection: (id: string) => void
  clearSelection: () => void
  setHighlightedEdgeId: (id: string | null) => void
  setHighlightedNodeId: (id: string | null) => void
  setContextMenu: (m: ViewState['contextMenu']) => void
  setStaleDays: (n: number) => void
  detailPanelAutoOpen: boolean
  setDetailPanelAutoOpen: (b: boolean) => void
  toggleDetailPanelAutoOpen: () => void
  setDetailPanelOpen: (b: boolean) => void
  openProjectPanel: (projectId: string, focusMilestoneId?: string | null) => void
  clearFocusedMilestone: () => void
  closeProjectPanel: () => void
  resetFilters: () => void
}

export const ACTIVE_STATES: IssueStateType[] = ['started', 'unstarted', 'backlog', 'triage']

export const defaultFilters: Filters = {
  stateTypes: ACTIVE_STATES,
  stateNames: [],
  activeOnly: true,
  myIssuesOnly: false,
  staleOnly: false,
  primaryValues: [],
  typeValues: [],
  priorities: [],
  assignees: [],
  prefixSelections: {},
  groupSelections: {},
  orphanValues: [],
  designdocFilter: 'all',
  dueFilter: 'any',
  projectIds: [],
  milestoneIds: [],
  recencyWindow: 'any',
  // 'updated' answers "what moved lately", the more common question, and
  // matches the timestamp staleOnly already reads.
  recencyMode: 'updated',
  negated: [],
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

export const useViewStore = create<ViewState>((set) => ({
  // Where a fresh session lands. Per-browser preference; a `?view=` in the
  // URL overrides it for that visit without rewriting it.
  activeView: readDefaultView(),
  filters: defaultFilters,
  focusedId: null,
  chainRootIds: [],
  chainDepthUp: null,
  chainDepthDown: null,
  layoutBump: 0,
  expandedBuckets: [],
  theme: readTheme(),
  density: 'default',
  mixGroupBy: null,
  fontSize: (() => {
    if (typeof window === 'undefined') return 'md' as FontSize
    const raw = window.localStorage?.getItem('ig-font-size')
    if (!raw) return 'md' as FontSize
    if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw
    const n = Number(raw)
    return Number.isFinite(n) && n >= 9 && n <= 24 ? n : ('md' as FontSize)
  })(),
  maxColsPerRow: (() => {
    if (typeof window === 'undefined') return 4
    const raw = window.localStorage?.getItem('ig-max-cols')
    if (!raw) return 4
    const n = Number(raw)
    // Clamp to a sane range — 2 is the minimum that still feels like a grid,
    // 8 covers ultrawide screens. Outside the range falls back to default.
    return Number.isFinite(n) && n >= 2 && n <= 8 ? n : 4
  })(),
  search: '',
  inlineSearch: { open: false, query: '', activeIdx: 0 },
  settingsOpen: false,
  syncHistoryOpen: false,
  coverageOpen: false,
  shortcutsOpen: false,
  notesOpen: false,
  focusedNoteId: null,
  noteFindOpen: false,
  panToFocusedSeq: 0,
  focusArrivalSeq: 0,
  deepLinkFocusFallbackArmed: false,
  // Whether chain/dependency views include "related" (non-blocking) edges.
  // Sticky per-browser via localStorage so it survives reloads and deep links
  // (e.g. a Raycast chain link that doesn't specify `related`) — flip the
  // toolbar toggle once and it's remembered. Default: OFF.
  showRelated:
    typeof window !== 'undefined' && window.localStorage?.getItem('ig-show-related') === '1' ? true : false,
  // Same sticky-per-browser treatment as showRelated. Default: OFF.
  showHierarchy:
    typeof window !== 'undefined' && window.localStorage?.getItem('ig-show-hierarchy') === '1' ? true : false,
  selection: [],
  highlightedEdgeId: null,
  highlightedNodeId: null,
  contextMenu: null,
  staleDays: readStaleDays(),
  appliedSavedViewId: null,
  setAppliedSavedViewId: (id) => set({ appliedSavedViewId: id }),
  visibleIssueCount: null,
  setVisibleIssueCount: (n) => set({ visibleIssueCount: n }),
  filterPanelPinned:
    typeof window !== 'undefined' && window.localStorage?.getItem('ig-filter-pinned') === '0'
      ? false
      : true,
  toggleFilterPanelPinned: () =>
    set((s) => {
      const next = !s.filterPanelPinned
      if (typeof window !== 'undefined') {
        window.localStorage?.setItem('ig-filter-pinned', next ? '1' : '0')
      }
      return { filterPanelPinned: next }
    }),
  // Decouples "I want to focus this issue" (for chain mode, find, etc.)
  // from "I want to read its details". When OFF, clicking an issue still
  // sets focusedId but DetailPanel doesn't render — the canvas stays
  // full-width. Persists per-browser via localStorage. Default: OFF so
  // the graph-first workflow is the default; users who want the panel
  // can flip the toolbar toggle once and it sticks.
  detailPanelAutoOpen:
    typeof window !== 'undefined' && window.localStorage?.getItem('ig-detail-panel-auto') === '1' ? true : false,
  detailPanelOpen: false,
  focusedProjectId: null,
  focusedMilestoneId: null,
  projectPanelOpen: false,

  // Does NOT persist: switching view is a transient act, while the stored
  // default is "where new sessions start" and is only written from Settings.
  setActiveView: (v) => set({ activeView: v }),
  setFilter: (k, v) => set((s) => ({ filters: { ...s.filters, [k]: v } })),
  toggleStateType: (t) =>
    set((s) => {
      const nextTypes = toggle(s.filters.stateTypes, t)
      // Auto-disable activeOnly when user explicitly turns ON a non-active
      // state — otherwise the click silently has no effect because activeOnly
      // would still filter the issue out. Only fires when ADDING the state
      // (toggle direction = on); turning it off keeps activeOnly as-is.
      const isAdding = nextTypes.includes(t) && !s.filters.stateTypes.includes(t)
      const isNonActive = t === 'completed' || t === 'canceled'
      const activeOnly = isAdding && isNonActive ? false : s.filters.activeOnly
      // Names refine within their own type, so unchecking a type must take its
      // children with it — leaving them behind would keep matching issues of a
      // type the user just switched off. Other types' names are untouched;
      // that independence is the whole point of the tree.
      const removingType = !nextTypes.includes(t) && s.filters.stateTypes.includes(t)
      const stateNames = removingType
        ? s.filters.stateNames.filter((k) => !k.startsWith(`${t}::`))
        : s.filters.stateNames
      return { filters: { ...s.filters, stateTypes: nextTypes, stateNames, activeOnly } }
    }),
  toggleStateName: (name) => set((s) => ({ filters: { ...s.filters, stateNames: toggle(s.filters.stateNames, name) } })),
  togglePrimary: (id) => set((s) => ({ filters: { ...s.filters, primaryValues: toggle(s.filters.primaryValues, id) } })),
  toggleType: (id) => set((s) => ({ filters: { ...s.filters, typeValues: toggle(s.filters.typeValues, id) } })),
  togglePriority: (p) => set((s) => ({ filters: { ...s.filters, priorities: toggle(s.filters.priorities, p) } })),
  toggleAssignee: (name) => set((s) => ({ filters: { ...s.filters, assignees: toggle(s.filters.assignees, name) } })),
  togglePrefix: (token, id) =>
    set((s) => {
      const cur = s.filters.prefixSelections[token] ?? []
      return {
        filters: {
          ...s.filters,
          prefixSelections: { ...s.filters.prefixSelections, [token]: toggle(cur, id) },
        },
      }
    }),
  toggleGroupLabel: (group, id) =>
    set((s) => {
      const cur = s.filters.groupSelections[group] ?? []
      return {
        filters: {
          ...s.filters,
          groupSelections: { ...s.filters.groupSelections, [group]: toggle(cur, id) },
        },
      }
    }),
  toggleOrphan: (id) => set((s) => ({ filters: { ...s.filters, orphanValues: toggle(s.filters.orphanValues, id) } })),
  toggleProject: (id) => set((s) => ({ filters: { ...s.filters, projectIds: toggle(s.filters.projectIds, id) } })),
  toggleMilestone: (key) =>
    set((s) => ({ filters: { ...s.filters, milestoneIds: toggle(s.filters.milestoneIds, key) } })),
  setFocusedId: (id) =>
    set((s) => {
      const detailPanelOpen = id !== null && (s.detailPanelAutoOpen || s.detailPanelOpen)
      // Mutex: focusing an issue closes the project panel (right-edge slot is
      // shared). Closing the project panel here doesn't clear focusedProjectId
      // so a later "back to project" UX could restore it without re-fetching.
      const projectPanelOpen = detailPanelOpen ? false : s.projectPanelOpen
      return { focusedId: id, detailPanelOpen, projectPanelOpen }
    }),
  setChainRootId: (id) => set({ chainRootIds: id ? [id] : [] }),
  setChainRootIds: (ids) => set({ chainRootIds: ids }),
  setChainDepthUp: (depth) => set({ chainDepthUp: depth }),
  setChainDepthDown: (depth) => set({ chainDepthDown: depth }),
  bumpLayout: () => set((s) => ({ layoutBump: s.layoutBump + 1 })),
  setTheme: (t) => {
    writeTheme(t)
    set({ theme: t })
  },
  setDensity: (d) => set({ density: d }),
  setMixGroupBy: (key) => set({ mixGroupBy: key }),
  setFontSize: (f) => {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('ig-font-size', String(f))
    }
    set({ fontSize: f })
  },
  setMaxColsPerRow: (n) => {
    // Defensive clamp at the setter too so a bad caller can't poison state.
    const clamped = Math.max(2, Math.min(8, Math.round(n)))
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('ig-max-cols', String(clamped))
    }
    set({ maxColsPerRow: clamped })
  },
  setSearch: (q) => set({ search: q }),
  openInlineSearch: () => set((s) => ({ inlineSearch: { ...s.inlineSearch, open: true } })),
  // Preserve query + activeIdx on close. Cmd+F again should bring back the
  // user's last search (with the input pre-selected for fast replace) rather
  // than starting from scratch every time.
  closeInlineSearch: () =>
    set((s) => ({ inlineSearch: { ...s.inlineSearch, open: false } })),
  setInlineSearchQuery: (q) =>
    set((s) => ({ inlineSearch: { ...s.inlineSearch, query: q, activeIdx: 0 } })),
  setInlineSearchActiveIdx: (i) =>
    set((s) => ({ inlineSearch: { ...s.inlineSearch, activeIdx: i } })),
  setSettingsOpen: (b) => set({ settingsOpen: b }),
  setSyncHistoryOpen: (b) => set({ syncHistoryOpen: b }),
  setCoverageOpen: (b) => set({ coverageOpen: b }),
  setShortcutsOpen: (b) => set({ shortcutsOpen: b }),
  // Preserve focusedNoteId across open/close cycles so the n shortcut acts as
  // a true toggle that restores the user's last view. Use the in-modal Back
  // button (or Esc-peel) to drop back to the grid explicitly.
  setNotesOpen: (b) => set({ notesOpen: b }),
  setFocusedNoteId: (id) => set({ focusedNoteId: id, noteFindOpen: false }),
  setNoteFindOpen: (b) => set({ noteFindOpen: b }),
  requestPanToFocused: () => set((s) => ({ panToFocusedSeq: s.panToFocusedSeq + 1 })),
  notifyDeepLinkFocus: (armed) =>
    set((s) => ({ focusArrivalSeq: s.focusArrivalSeq + 1, deepLinkFocusFallbackArmed: armed })),
  clearDeepLinkFocusFallback: () => set({ deepLinkFocusFallbackArmed: false }),
  setShowRelated: (b) => {
    if (typeof window !== 'undefined') window.localStorage?.setItem('ig-show-related', b ? '1' : '0')
    set({ showRelated: b })
  },
  setShowHierarchy: (b) => {
    if (typeof window !== 'undefined') window.localStorage?.setItem('ig-show-hierarchy', b ? '1' : '0')
    set({ showHierarchy: b })
  },
  setSelection: (s) => set({ selection: s }),
  toggleSelection: (id) => set((s) => ({ selection: toggle(s.selection, id) })),
  clearSelection: () => set({ selection: [] }),
  setHighlightedEdgeId: (id) => set({ highlightedEdgeId: id }),
  setHighlightedNodeId: (id) => set({ highlightedNodeId: id }),
  setContextMenu: (m) => set({ contextMenu: m }),
  setStaleDays: (n) => {
    writeStaleDays(n)
    set({ staleDays: n })
  },
  setDetailPanelAutoOpen: (b) => {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('ig-detail-panel-auto', b ? '1' : '0')
    }
    set({ detailPanelAutoOpen: b })
  },
  toggleDetailPanelAutoOpen: () =>
    set((s) => {
      const next = !s.detailPanelAutoOpen
      if (typeof window !== 'undefined') {
        window.localStorage?.setItem('ig-detail-panel-auto', next ? '1' : '0')
      }
      return {
        detailPanelAutoOpen: next,
        // Toggling the preference also flips the current panel visibility,
        // gated on having a focused issue (no point opening a panel with
        // no content). User experience: flipping the toolbar toggle has
        // an immediate, visible effect.
        detailPanelOpen: next && s.focusedId !== null,
      }
    }),
  setDetailPanelOpen: (b) => set({ detailPanelOpen: b }),
  openProjectPanel: (projectId, focusMilestoneId = null) =>
    set({
      focusedProjectId: projectId,
      focusedMilestoneId: focusMilestoneId,
      projectPanelOpen: true,
      // Mutex with the issue detail panel (right-edge slot is shared). Don't
      // clear focusedId — switching back to the issue panel later shouldn't
      // re-trigger a focus / re-pan.
      detailPanelOpen: false,
    }),
  clearFocusedMilestone: () => set({ focusedMilestoneId: null }),
  closeProjectPanel: () => set({ projectPanelOpen: false, focusedProjectId: null, focusedMilestoneId: null }),
  resetFilters: () => set({ filters: defaultFilters, chainRootIds: [] }),
}))
