// Browser-tab-local workspace state. Two layers:
//
// 1. Profiles + server-default come from the backend (`GET /api/workspaces`).
//    These describe what the server knows about; they don't change as the
//    user clicks around.
// 2. **In-app tabs** — a list of "view sessions", each pinned to one
//    workspace. The user can have multiple tabs on the same workspace
//    (e.g. one filtered to a chain, another with different filters).
//    Tab list + active tab persist via localStorage so closing and
//    reopening the browser keeps your tab layout. Per-tab view state
//    (filters, focus, viewport) is persisted separately by tabStateStore.
//
// `currentWorkspaceId` is a maintained derived field — it always equals the
// active tab's workspace. Code that asks "which workspace does this fetch
// belong to?" reads currentWorkspaceId; the tab indirection is invisible.

import { create } from 'zustand'
import type { WorkspaceProfile } from '../lib/api'

export interface Tab {
  id: string
  workspaceId: string
}

interface WorkspaceState {
  // Server-provided
  profiles: WorkspaceProfile[]
  unconfigured: boolean
  defaultWorkspaceId: string | null
  initialized: boolean

  // In-app tabs
  tabs: Tab[]
  activeTabId: string | null

  // Derived: current tab's workspaceId. Maintained by every action.
  currentWorkspaceId: string | null

  // Setters for server-provided
  setProfiles: (profiles: WorkspaceProfile[]) => void
  setUnconfigured: (legacy: boolean) => void
  setDefaultWorkspaceId: (id: string | null) => void
  setInitialized: (v: boolean) => void

  // Tab actions
  setTabs: (tabs: Tab[], activeTabId: string | null) => void
  addTab: (workspaceId: string) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  /** Move a tab from one index to another. Used by drag-to-reorder. */
  reorderTabs: (fromIndex: number, toIndex: number) => void
  /** Repoint a tab at a different workspace, keeping its position +
   *  view-state snapshot key. Used by the SyncBanner pill picker so the
   *  user can swap "what this tab is looking at" without spawning a new
   *  tab and losing their filters/focus. */
  changeTabWorkspace: (tabId: string, workspaceId: string) => void
  /** Back-compat: set the active tab's workspace. Used by urlSync on
   *  initial parse (`?w=` from URL) before any tab actions exist. */
  setCurrentWorkspaceId: (id: string | null) => void
}

const STORAGE_KEY = 'issue-graph-tabs'
// Bump when PersistedTabs shape changes incompatibly. The hydrate path
// discards saved data on mismatch instead of trying to migrate — tab
// layout is cheap to recreate and ad-hoc migrations get brittle fast.
const STORAGE_VERSION = 1

interface PersistedTabs {
  version: number
  tabs: Tab[]
  activeTabId: string | null
}

export function makeTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function sameProfiles(a: WorkspaceProfile[], b: WorkspaceProfile[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (!x || !y) return false
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.linearApiKeySet !== y.linearApiKeySet ||
      x.webhookSecretSet !== y.webhookSecretSet ||
      x.linearTeamId !== y.linearTeamId ||
      x.dbPath !== y.dbPath
    ) {
      return false
    }
  }
  return true
}

function loadPersisted(): PersistedTabs | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedTabs>
    if (parsed.version !== STORAGE_VERSION) return null
    if (!Array.isArray(parsed.tabs)) return null
    if (parsed.tabs.length === 0) return null
    const valid = parsed.tabs.every(
      (t) => t && typeof t.id === 'string' && typeof t.workspaceId === 'string',
    )
    if (!valid) return null
    return {
      version: parsed.version,
      tabs: parsed.tabs,
      activeTabId: parsed.activeTabId ?? null,
    }
  } catch {
    return null
  }
}

function savePersisted(tabs: Tab[], activeTabId: string | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: PersistedTabs = { version: STORAGE_VERSION, tabs, activeTabId }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota / private mode — just skip persistence.
  }
}

const persisted = loadPersisted()

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  profiles: [],
  unconfigured: false,
  defaultWorkspaceId: null,
  initialized: false,

  tabs: persisted?.tabs ?? [],
  activeTabId: persisted?.activeTabId ?? null,
  currentWorkspaceId: (() => {
    if (!persisted) return null
    return persisted.tabs.find((t) => t.id === persisted.activeTabId)?.workspaceId ?? null
  })(),

  setProfiles: (profiles) =>
    set((s) => (sameProfiles(s.profiles, profiles) ? s : { profiles })),
  setUnconfigured: (unconfigured) =>
    set((s) => (s.unconfigured === unconfigured ? s : { unconfigured })),
  setDefaultWorkspaceId: (defaultWorkspaceId) =>
    set((s) => (s.defaultWorkspaceId === defaultWorkspaceId ? s : { defaultWorkspaceId })),
  setInitialized: (initialized) =>
    set((s) => (s.initialized === initialized ? s : { initialized })),

  setTabs: (tabs, activeTabId) => {
    const active = tabs.find((t) => t.id === activeTabId) ?? null
    savePersisted(tabs, active?.id ?? null)
    set({
      tabs,
      activeTabId: active?.id ?? null,
      currentWorkspaceId: active?.workspaceId ?? null,
    })
  },

  addTab: (workspaceId) => {
    const id = makeTabId()
    set((s) => {
      const tabs = [...s.tabs, { id, workspaceId }]
      savePersisted(tabs, id)
      return { tabs, activeTabId: id, currentWorkspaceId: workspaceId }
    })
    return id
  },

  closeTab: (tabId) => {
    set((s) => {
      // Refuse to close the last tab — keeps the bar non-empty so there's
      // always somewhere to land.
      if (s.tabs.length <= 1) return s
      const idx = s.tabs.findIndex((t) => t.id === tabId)
      if (idx === -1) return s
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      let activeTabId = s.activeTabId
      let currentWorkspaceId = s.currentWorkspaceId
      if (s.activeTabId === tabId) {
        const next = tabs[Math.min(idx, tabs.length - 1)]
        activeTabId = next?.id ?? null
        currentWorkspaceId = next?.workspaceId ?? null
      }
      savePersisted(tabs, activeTabId)
      return { tabs, activeTabId, currentWorkspaceId }
    })
  },

  setActiveTab: (tabId) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId)
      if (!tab || tab.id === s.activeTabId) return s
      savePersisted(s.tabs, tabId)
      return { activeTabId: tabId, currentWorkspaceId: tab.workspaceId }
    })
  },

  changeTabWorkspace: (tabId, workspaceId) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId)
      if (idx === -1) return s
      const cur = s.tabs[idx]
      if (!cur || cur.workspaceId === workspaceId) return s
      const tabs = s.tabs.map((t, i) => (i === idx ? { ...t, workspaceId } : t))
      savePersisted(tabs, s.activeTabId)
      return {
        tabs,
        currentWorkspaceId:
          s.activeTabId === tabId ? workspaceId : s.currentWorkspaceId,
      }
    })
  },

  reorderTabs: (fromIndex, toIndex) => {
    set((s) => {
      if (fromIndex === toIndex) return s
      if (fromIndex < 0 || fromIndex >= s.tabs.length) return s
      const clamped = Math.max(0, Math.min(toIndex, s.tabs.length - 1))
      const next = s.tabs.slice()
      const [moved] = next.splice(fromIndex, 1)
      if (!moved) return s
      next.splice(clamped, 0, moved)
      savePersisted(next, s.activeTabId)
      // currentWorkspaceId only depends on which tab is active, not order.
      return { tabs: next }
    })
  },

  setCurrentWorkspaceId: (id) => {
    // Back-compat path used by urlSync.parseUrl on initial mount.
    // Two cases:
    //   - No tabs yet (very first load): just stash the workspace id; the
    //     bootstrap effect creates tabs and uses this as a hint.
    //   - Active tab exists: change its workspaceId in place. Keeps
    //     URL ?w= and active-tab semantics aligned.
    set((s) => {
      if (s.tabs.length === 0 || !s.activeTabId) {
        if (s.currentWorkspaceId === id) return s
        return { currentWorkspaceId: id }
      }
      if (id === s.currentWorkspaceId) return s
      // No tab can carry a null workspaceId. If the URL passes ?w= empty,
      // leave the existing tab alone and just clear the derived field —
      // the bootstrap effect will reconcile after profiles load.
      if (id === null) return { currentWorkspaceId: null }
      const tabs = s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, workspaceId: id } : t,
      )
      savePersisted(tabs, s.activeTabId)
      return { tabs, currentWorkspaceId: id }
    })
  },
}))
