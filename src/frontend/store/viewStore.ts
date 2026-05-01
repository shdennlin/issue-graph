import { create } from 'zustand'
import type { IssueStateType } from '@shared/types.js'

export type ViewId = 'dependency' | 'bucket' | 'mix' | 'timeline' | 'designdoc'
export type Density = 'compact' | 'default' | 'verbose'
export type ThemeMode = 'light' | 'dark' | 'auto'

export interface Filters {
  stateTypes: IssueStateType[]
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
  expandedBuckets: string[]
  theme: ThemeMode
  density: Density
  settingsOpen: boolean
  syncHistoryOpen: boolean
  selection: string[] // multi-select identifiers
  contextMenu: { x: number; y: number; targetIdentifier: string } | null
  staleDays: number

  setActiveView: (v: ViewId) => void
  setFilter: <K extends keyof Filters>(k: K, v: Filters[K]) => void
  toggleStateType: (t: IssueStateType) => void
  togglePrimary: (id: string) => void
  toggleType: (id: string) => void
  togglePriority: (p: number) => void
  toggleAssignee: (name: string) => void
  togglePrefix: (token: string, id: string) => void
  setFocusedId: (id: string | null) => void
  setTheme: (t: ThemeMode) => void
  setDensity: (d: Density) => void
  setSettingsOpen: (b: boolean) => void
  setSyncHistoryOpen: (b: boolean) => void
  setSelection: (s: string[]) => void
  toggleSelection: (id: string) => void
  clearSelection: () => void
  setContextMenu: (m: ViewState['contextMenu']) => void
  setStaleDays: (n: number) => void
  resetFilters: () => void
}

const ACTIVE_STATES: IssueStateType[] = ['started', 'unstarted', 'backlog', 'triage']

const defaultFilters: Filters = {
  stateTypes: ACTIVE_STATES,
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
  expandedBuckets: [],
  theme: 'auto',
  density: 'default',
  settingsOpen: false,
  syncHistoryOpen: false,
  selection: [],
  contextMenu: null,
  staleDays: 14,

  setActiveView: (v) => set({ activeView: v }),
  setFilter: (k, v) => set((s) => ({ filters: { ...s.filters, [k]: v } })),
  toggleStateType: (t) => set((s) => ({ filters: { ...s.filters, stateTypes: toggle(s.filters.stateTypes, t) } })),
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
  setTheme: (t) => set({ theme: t }),
  setDensity: (d) => set({ density: d }),
  setSettingsOpen: (b) => set({ settingsOpen: b }),
  setSyncHistoryOpen: (b) => set({ syncHistoryOpen: b }),
  setSelection: (s) => set({ selection: s }),
  toggleSelection: (id) => set((s) => ({ selection: toggle(s.selection, id) })),
  clearSelection: () => set({ selection: [] }),
  setContextMenu: (m) => set({ contextMenu: m }),
  setStaleDays: (n) => set({ staleDays: n }),
  resetFilters: () => set({ filters: defaultFilters }),
}))
