import { create } from 'zustand'
import type { NoteDTO } from '@shared/types.js'
import { notesApi } from '../lib/notesApi'

interface DeletedSnapshot {
  note: NoteDTO
  expiresAt: number
}

interface NotesState {
  /** Active (non-archived) notes — the default grid surface. */
  notes: NoteDTO[]
  /** Archived notes — surfaced behind the Archived view toggle. */
  archivedNotes: NoteDTO[]
  status: 'idle' | 'loading' | 'error'
  error: string | null
  /** Most recently deleted note, kept ~3s for undo. Cleared on subsequent deletes. */
  lastDeleted: DeletedSnapshot | null

  load: () => Promise<void>
  loadArchived: () => Promise<void>
  create: () => Promise<number>
  updateBody: (id: number, body: string) => void
  delete: (id: number) => Promise<void>
  undoDelete: () => Promise<void>
  reorder: (orderedIds: number[]) => Promise<void>
  setArchived: (id: number, archived: boolean) => Promise<void>
  /** Best-effort flush — useful before closing the editor. */
  flushPending: () => Promise<void>
}

const DEBOUNCE_MS = 500
// 10s gives the user a comfortable window to undo an accidental delete
// without leaving the toast hanging forever. Tied to the toast's countdown
// in UndoToast and the auto-clear timer in delete().
const UNDO_WINDOW_MS = 10_000

// Per-note debounce timers and the latest body waiting to be persisted.
const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>()
const pendingBodies = new Map<number, string>()

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  archivedNotes: [],
  status: 'idle',
  error: null,
  lastDeleted: null,

  load: async () => {
    set({ status: 'loading', error: null })
    try {
      const { entries } = await notesApi.list('active')
      set({ notes: entries, status: 'idle' })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  loadArchived: async () => {
    try {
      const { entries } = await notesApi.list('archived')
      set({ archivedNotes: entries })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  create: async () => {
    const res = await notesApi.create('')
    const now = Date.now()
    const newNote: NoteDTO = {
      id: res.id,
      body: '',
      sortOrder: res.sortOrder,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({ notes: [newNote, ...s.notes] }))
    return res.id
  },

  updateBody: (id, body) => {
    // Optimistic local update — UI reflects edits immediately.
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, body, updatedAt: Date.now() } : n)),
    }))
    pendingBodies.set(id, body)
    const existing = pendingTimers.get(id)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      const pending = pendingBodies.get(id)
      if (pending === undefined) return
      pendingBodies.delete(id)
      pendingTimers.delete(id)
      notesApi.update(id, pending).catch(() => {
        // Network failure: keep local copy, surface the error state.
        set({ status: 'error', error: 'Failed to save note' })
      })
    }, DEBOUNCE_MS)
    pendingTimers.set(id, t)
  },

  flushPending: async () => {
    const ids = Array.from(pendingBodies.keys())
    await Promise.all(
      ids.map((id) => {
        const body = pendingBodies.get(id)
        const timer = pendingTimers.get(id)
        if (timer) clearTimeout(timer)
        pendingBodies.delete(id)
        pendingTimers.delete(id)
        if (body === undefined) return Promise.resolve()
        return notesApi.update(id, body).catch(() => {
          set({ status: 'error', error: 'Failed to save note' })
        })
      }),
    )
  },

  delete: async (id) => {
    // Notes can be deleted from either the active grid or the archived view,
    // so check both buckets and remove from whichever holds the row.
    const cur = get()
    const fromActive = cur.notes.find((n) => n.id === id)
    const fromArchived = cur.archivedNotes.find((n) => n.id === id)
    const target = fromActive ?? fromArchived
    if (!target) return
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      archivedNotes: s.archivedNotes.filter((n) => n.id !== id),
      lastDeleted: { note: target, expiresAt: Date.now() + UNDO_WINDOW_MS },
    }))
    try {
      await notesApi.delete(id)
    } catch (e) {
      // Restore on failure into the bucket it came from.
      set((s) => ({
        notes: target.archived ? s.notes : [...s.notes, target].sort((a, b) => a.sortOrder - b.sortOrder),
        archivedNotes: target.archived
          ? [...s.archivedNotes, target].sort((a, b) => a.sortOrder - b.sortOrder)
          : s.archivedNotes,
        lastDeleted: null,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      }))
      return
    }
    // Auto-expire the undo window.
    setTimeout(() => {
      const last = get().lastDeleted
      if (last && last.note.id === id) set({ lastDeleted: null })
    }, UNDO_WINDOW_MS)
  },

  undoDelete: async () => {
    const snap = get().lastDeleted
    if (!snap) return
    // Recreate server-side. We can't restore the exact id (autoincrement),
    // but sort_order brings it back visually to the same slot, and a follow-
    // up PATCH re-applies the archived flag when needed.
    const wasArchived = snap.note.archived
    try {
      const created = await notesApi.create(snap.note.body)
      const restored: NoteDTO = {
        id: created.id,
        body: snap.note.body,
        sortOrder: snap.note.sortOrder,
        archived: wasArchived,
        createdAt: snap.note.createdAt,
        updatedAt: Date.now(),
      }
      if (wasArchived) {
        // Restore into the archived bucket and flip the flag on the server.
        const others = get().archivedNotes.filter((n) => n.id !== created.id)
        const merged = [...others, restored].sort((a, b) => a.sortOrder - b.sortOrder)
        set((s) => ({
          // Server-side, the new note was created as active — the active
          // bucket might now contain it. Clean it up before the PATCH runs.
          notes: s.notes.filter((n) => n.id !== created.id),
          archivedNotes: merged,
          lastDeleted: null,
        }))
        await notesApi.setArchived(created.id, true)
      } else {
        const others = get().notes.filter((n) => n.id !== created.id)
        const merged = [...others, restored].sort((a, b) => a.sortOrder - b.sortOrder)
        set({ notes: merged, lastDeleted: null })
        await notesApi.reorder(merged.map((n) => n.id))
      }
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  reorder: async (orderedIds) => {
    // Optimistic: assign new sort_orders locally.
    const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]))
    set((s) => ({
      notes: s.notes
        .map((n) => ({ ...n, sortOrder: orderMap.get(n.id) ?? n.sortOrder }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    try {
      await notesApi.reorder(orderedIds)
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  setArchived: async (id, archived) => {
    // Find the note (in either bucket) and move it to the other.
    const cur = get()
    const fromActive = cur.notes.find((n) => n.id === id)
    const fromArchived = cur.archivedNotes.find((n) => n.id === id)
    const target = fromActive ?? fromArchived
    if (!target) return
    const updated: NoteDTO = { ...target, archived, updatedAt: Date.now() }
    set((s) => ({
      notes: archived
        ? s.notes.filter((n) => n.id !== id)
        : (s.notes.some((n) => n.id === id) ? s.notes : [updated, ...s.notes]),
      archivedNotes: archived
        ? (s.archivedNotes.some((n) => n.id === id) ? s.archivedNotes : [updated, ...s.archivedNotes])
        : s.archivedNotes.filter((n) => n.id !== id),
    }))
    try {
      await notesApi.setArchived(id, archived)
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      // Best-effort revert by refetching both lists.
      void get().load()
      void get().loadArchived()
    }
  },
}))
