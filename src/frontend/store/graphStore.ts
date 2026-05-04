import { create } from 'zustand'
import type { GraphResponse } from '@shared/types.js'
import { api } from '../lib/api'

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
  forceSync: () => Promise<void>
  /**
   * Lazy-fetch extension. Used by the State filter when the user explicitly
   * checks Canceled/Completed — backend pulls those state types within `days`
   * (max 365), then we reload the graph.
   */
  extendScope: (days: number) => Promise<void>
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
