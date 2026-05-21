import { create } from 'zustand'
import type { GraphResponse, ProjectDetail } from '@shared/types.js'
import { api } from '../lib/api'

/**
 * Stored value for a single project's lazy-loaded detail. String sentinels
 * keep the loading / error states in the same map so callers can drive UI
 * (skeleton vs retry button vs real data) off one lookup.
 */
export type ProjectDetailCacheEntry = ProjectDetail | 'loading' | 'error'

interface GraphState {
  graph: GraphResponse | null
  status: 'idle' | 'loading' | 'error'
  // True only while a real sync (POST /api/sync or extend-scope refetch) is
  // in flight. Distinct from `status: 'loading'` which is also set during
  // plain cache reads — the UI uses this to show "Syncing…" only when the
  // server is actually re-fetching from Linear, not just returning cached data.
  syncing: boolean
  error: string | null
  load: () => Promise<void>
  /**
   * Silent re-fetch used by the background poller. Same network call as
   * `load()` but doesn't flip status to 'loading' — so the UI doesn't blink
   * just because we're checking whether the backend's bg sync produced
   * fresher data. Updates `graph` only when fetchedAt actually moved.
   */
  refetchIfNewer: () => Promise<void>
  /**
   * Silent always-replace. Used by SSE event handlers (e.g. designdoc-
   * changed) where the trigger isn't tied to fetchedAt — local file edits
   * don't bump last_sync_ms — so we just want to pull the latest graph
   * state and replace. No loading flash.
   */
  refetchSilent: () => Promise<void>
  forceSync: () => Promise<void>
  /**
   * Lazy-fetch extension. Used by the State filter when the user explicitly
   * checks Canceled/Completed — backend pulls those state types within `days`
   * (max 365), then we reload the graph.
   */
  extendScope: (days: number) => Promise<void>
  /** Cache of fetched project details, keyed by Linear project id. */
  projectDetails: Record<string, ProjectDetailCacheEntry>
  /**
   * Lazy-fetch a project's detail. No-op if already loaded or in-flight.
   * `force: true` re-fetches even when cached (used by panel's retry button).
   */
  loadProjectDetail: (projectId: string, opts?: { force?: boolean }) => Promise<void>
}

export const useGraphStore = create<GraphState>((set, get) => ({
  graph: null,
  status: 'idle',
  syncing: false,
  error: null,
  async load() {
    set({ status: 'loading', error: null })
    try {
      const graph = await api.fetchGraph()
      set({ graph, status: 'idle' })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
  async refetchIfNewer() {
    try {
      const fresh = await api.fetchGraph()
      const current = get().graph
      if (!current || fresh.fetchedAt > (current.fetchedAt ?? 0)) {
        set({ graph: fresh })
      }
    } catch {
      // Silent — this is opportunistic. If polling fails, the next manual
      // refresh / sync will surface a real error.
    }
  },
  async refetchSilent() {
    try {
      const fresh = await api.fetchGraph()
      set({ graph: fresh })
    } catch {
      // Silent — caller is a real-time event handler; failing once is fine,
      // the next event or the polling cycle will catch up.
    }
  },
  async forceSync() {
    set({ status: 'loading', syncing: true })
    try {
      await api.forceSync()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
    set({ syncing: false })
    await get().load()
  },
  projectDetails: {},
  async loadProjectDetail(projectId, opts) {
    if (!projectId) return
    const current = get().projectDetails[projectId]
    if (!opts?.force && current && current !== 'error') return
    set((s) => ({ projectDetails: { ...s.projectDetails, [projectId]: 'loading' } }))
    try {
      const res = await api.fetchProjectDetail(projectId)
      set((s) => ({ projectDetails: { ...s.projectDetails, [projectId]: res.data } }))
    } catch {
      set((s) => ({ projectDetails: { ...s.projectDetails, [projectId]: 'error' } }))
    }
  },
  async extendScope(days) {
    set({ status: 'loading', syncing: true })
    try {
      const r = await api.extendSyncScope(days)
      // If backend says it didn't refetch (already covered or just cleared),
      // skip the second graph load — cached data is up to date.
      set({ syncing: false })
      if (r.refetched) await get().load()
      else set({ status: 'idle' })
    } catch (e) {
      set({ status: 'error', syncing: false, error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
