import type { NoteDTO } from '@shared/types.js'
import { withWorkspaceParam } from './api'

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const url = withWorkspaceParam(path)
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export const notesApi = {
  /** archived: 'active' (default) | 'archived' | 'all' */
  list: (archived: 'active' | 'archived' | 'all' = 'active') => {
    const q = archived === 'active' ? '' : archived === 'archived' ? '?archived=1' : '?archived=all'
    return http<{ entries: NoteDTO[] }>(`/api/notes${q}`)
  },
  create: (body?: string) =>
    http<{ id: number; sortOrder: number }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ body: body ?? '' }),
    }),
  update: (id: number, body: string) =>
    http<{ ok: boolean }>(`/api/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }),
  setArchived: (id: number, archived: boolean) =>
    http<{ ok: boolean }>(`/api/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    }),
  delete: (id: number) => http<{ ok: boolean }>(`/api/notes/${id}`, { method: 'DELETE' }),
  reorder: (orderedIds: number[]) =>
    http<{ ok: boolean }>('/api/notes/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    }),
  uploadAsset: async (noteId: number, file: File): Promise<{ url: string }> => {
    const form = new FormData()
    form.append('file', file)
    const url = withWorkspaceParam(`/api/notes/${noteId}/assets`)
    const res = await fetch(url, { method: 'POST', body: form })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${res.status} upload: ${text.slice(0, 200)}`)
    }
    return (await res.json()) as { url: string }
  },
}
