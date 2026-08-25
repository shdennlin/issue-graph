// Saved views: named snapshots of the URL's view + filter state, stored on the
// server so everyone reaching this instance sees the same list.
//
// Much smaller than notesStore because saved views need none of what makes that
// one complex: no debounced autosave (a view is written on an explicit click),
// no undo window, no assets. Optimistic updates with a refetch on failure are
// enough.

import { create } from 'zustand'
import type { SavedViewDTO } from '@shared/types.js'
import { api } from '../lib/api'

interface SavedViewsState {
  views: SavedViewDTO[]
  status: 'idle' | 'loading' | 'error'
  /** The raw thrown value, not a message. apiErrorMessage() needs a `t`, which
   *  belongs to the component tree — translating here would freeze the string
   *  at the locale that happened to be active when the request failed. */
  error: unknown
  load: () => Promise<void>
  create: (name: string, query: string) => Promise<void>
  rename: (id: number, name: string) => Promise<void>
  update: (id: number, query: string) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useSavedViewsStore = create<SavedViewsState>((set, get) => ({
  views: [],
  status: 'idle',
  error: null,

  async load() {
    set({ status: 'loading', error: null })
    try {
      const r = await api.fetchSavedViews()
      set({ views: r.entries, status: 'idle' })
    } catch (e) {
      set({ status: 'error', error: e })
    }
  },

  async create(name, query) {
    try {
      const dto = await api.createSavedView(name, query)
      set((s) => ({ views: [...s.views, dto], error: null }))
    } catch (e) {
      set({ status: 'error', error: e })
    }
  },

  async rename(id, name) {
    const prev = get().views
    // Optimistic: renaming is the one action where the lag is most visible.
    set((s) => ({ views: s.views.map((v) => (v.id === id ? { ...v, name } : v)) }))
    try {
      await api.patchSavedView(id, { name })
    } catch (e) {
      set({ views: prev, status: 'error', error: e })
    }
  },

  async update(id, query) {
    const prev = get().views
    set((s) => ({ views: s.views.map((v) => (v.id === id ? { ...v, query } : v)) }))
    try {
      const dto = await api.patchSavedView(id, { query })
      // Take the server's copy: it strips `w` and the record-pointer params, so
      // the stored query is not necessarily what we sent.
      set((s) => ({ views: s.views.map((v) => (v.id === id ? dto : v)) }))
    } catch (e) {
      set({ views: prev, status: 'error', error: e })
    }
  },

  async remove(id) {
    const prev = get().views
    set((s) => ({ views: s.views.filter((v) => v.id !== id) }))
    try {
      await api.deleteSavedView(id)
    } catch (e) {
      set({ views: prev, status: 'error', error: e })
    }
  },
}))
