import { create } from 'zustand'
import type { IssueStateType } from '@shared/types.js'

export type ViewId = 'dependency' | 'mix' | 'project' | 'designdoc'
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
  search: string                 // toolbar filter search (narrows visible set)
  inlineSearch: { open: boolean; query: string; activeIdx: number }
  settingsOpen: boolean
  syncHistoryOpen: boolean
  coverageOpen: boolean
  shortcutsOpen: boolean
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

  setActiveView: (v: ViewId) => void
  setFilter: <K extends keyof Filters>(k: K, v: Filters[K]) => void
  toggleStateType: (t: IssueStateType) => void
  toggleStateName: (name: string) => void
  togglePrimary: (id: string) => void
  toggleType: (id: string) => void
  togglePriority: (p: number) => void
  toggleAssignee: (name: string) => void
  togglePrefix: (token: string, id: string) => void
  setFocusedId: (id: string | null) => void
  setChainRootId: (id: string | null) => void
  bumpLayout: () => void
  setTheme: (t: ThemeMode) => void
  setDensity: (d: Density) => void
  setFontSize: (f: FontSize) => void
  setSearch: (q: string) => void
  openInlineSearch: () => void
  closeInlineSearch: () => void
  setInlineSearchQuery: (q: string) => void
  setInlineSearchActiveIdx: (i: number) => void
  setSettingsOpen: (b: boolean) => void
  setSyncHistoryOpen: (b: boolean) => void
  setCoverageOpen: (b: boolean) => void
  setShortcutsOpen: (b: boolean) => void
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
  search: '',
  inlineSearch: { open: false, query: '', activeIdx: 0 },
  settingsOpen: false,
  syncHistoryOpen: false,
  coverageOpen: false,
  shortcutsOpen: false,
  showRelated: false,
  selection: [],
  highlightedEdgeId: null,
  highlightedNodeId: null,
  contextMenu: null,
  staleDays: 14,
  filterPanelOpen:
    typeof window !== 'undefined' && window.localStorage?.getItem('ig-filter-panel') === '0' ? false : true,

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
  setFocusedId: (id) => set({ focusedId: id }),
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
  resetFilters: () => set({ filters: defaultFilters, chainRootId: null }),
}))
