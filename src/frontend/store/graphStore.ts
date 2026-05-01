import { create } from 'zustand'
import type { GraphResponse } from '@shared/types.js'
import { api } from '../lib/api'

interface GraphState {
  graph: GraphResponse | null
  status: 'idle' | 'loading' | 'error'
  error: string | null
  load: () => Promise<void>
  forceSync: () => Promise<void>
}

export const useGraphStore = create<GraphState>((set, get) => ({
  graph: null,
  status: 'idle',
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
  async forceSync() {
    set({ status: 'loading' })
    try {
      await api.forceSync()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
    await get().load()
  },
}))
