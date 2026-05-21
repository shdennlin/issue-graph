import { create } from 'zustand'
import type { IssueStateType } from '@shared/types.js'

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
  tagIds: string[]
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
}

export interface ViewState {
  activeView: ViewId
  filters: Filters
  focusedId: string | null
  // When set, the dependency view filters to the connected component over
  // `blocks` edges (both directions, transitive) rooted at this identifier.
  // Other filters are bypassed while this is active so the chain doesn't
  // fragment. Ignored by mix/designdoc views.
  chainRootId: string | null
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
  // Monotonic counter — bump to ask GraphCanvas to pan/zoom onto the currently
  // focused issue. Useful when an external producer (e.g. a click on an issue
  // link inside a note) wants the camera to follow the focus change.
  panToFocusedSeq: number
  // When true, dependency view also draws `related` relations as dashed
  // edges (in addition to the always-on `blocks` edges). Off by default so
  // the dependency view stays focused on the dependency signal — turn on
  // when you want the wider context of "what's related but not blocking".
  showRelated: boolean
  selection: string[] // multi-select identifiers
  highlightedEdgeId: string | null // when set, the edge + its endpoints stay opaque, others dim
  highlightedNodeId: string | null // when set, the node + its connected edges/neighbors stay opaque
  contextMenu: { x: number; y: number; targetIdentifier: string } | null
  staleDays: number
  filterPanelOpen: boolean
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
  toggleProject: (id: string) => void
  toggleMilestone: (compositeKey: string) => void
  setFocusedId: (id: string | null) => void
  setChainRootId: (id: string | null) => void
  bumpLayout: () => void
  setTheme: (t: ThemeMode) => void
  setDensity: (d: Density) => void
  setFontSize: (f: FontSize) => void
  setMaxColsPerRow: (n: number) => void
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
  requestPanToFocused: () => void
  setShowRelated: (b: boolean) => void
  setSelection: (s: string[]) => void
  toggleSelection: (id: string) => void
  clearSelection: () => void
  setHighlightedEdgeId: (id: string | null) => void
  setHighlightedNodeId: (id: string | null) => void
  setContextMenu: (m: ViewState['contextMenu']) => void
  setStaleDays: (n: number) => void
  setFilterPanelOpen: (b: boolean) => void
  toggleFilterPanel: () => void
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
  tagIds: [],
  designdocFilter: 'all',
  dueFilter: 'any',
  projectIds: [],
  milestoneIds: [],
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: 'dependency',
  filters: defaultFilters,
  focusedId: null,
  chainRootId: null,
  layoutBump: 0,
  expandedBuckets: [],
  theme: 'auto',
  density: 'default',
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
  panToFocusedSeq: 0,
  showRelated: false,
  selection: [],
  highlightedEdgeId: null,
  highlightedNodeId: null,
  contextMenu: null,
  staleDays: 14,
  filterPanelOpen:
    typeof window !== 'undefined' && window.localStorage?.getItem('ig-filter-panel') === '0' ? false : true,
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
      return { filters: { ...s.filters, stateTypes: nextTypes, activeOnly } }
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
  setChainRootId: (id) => set({ chainRootId: id }),
  bumpLayout: () => set((s) => ({ layoutBump: s.layoutBump + 1 })),
  setTheme: (t) => set({ theme: t }),
  setDensity: (d) => set({ density: d }),
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
  setFocusedNoteId: (id) => set({ focusedNoteId: id }),
  requestPanToFocused: () => set((s) => ({ panToFocusedSeq: s.panToFocusedSeq + 1 })),
  setShowRelated: (b) => set({ showRelated: b }),
  setSelection: (s) => set({ selection: s }),
  toggleSelection: (id) => set((s) => ({ selection: toggle(s.selection, id) })),
  clearSelection: () => set({ selection: [] }),
  setHighlightedEdgeId: (id) => set({ highlightedEdgeId: id }),
  setHighlightedNodeId: (id) => set({ highlightedNodeId: id }),
  setContextMenu: (m) => set({ contextMenu: m }),
  setStaleDays: (n) => set({ staleDays: n }),
  setFilterPanelOpen: (b) => {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('ig-filter-panel', b ? '1' : '0')
    }
    set({ filterPanelOpen: b })
  },
  toggleFilterPanel: () =>
    set((s) => {
      const next = !s.filterPanelOpen
      if (typeof window !== 'undefined') {
        window.localStorage?.setItem('ig-filter-panel', next ? '1' : '0')
      }
      return { filterPanelOpen: next }
    }),
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
  resetFilters: () => set({ filters: defaultFilters, chainRootId: null }),
}))
