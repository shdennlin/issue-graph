// Pure saved-view logic: raw input in, validated row data out.
//
// No `bun:sqlite` import, and none allowed — vitest runs on Node and cannot
// resolve that specifier, so any module reaching it becomes untestable. The
// SQLite half lives in routes/savedViews.ts and stays thin enough not to need
// tests. This is the controlStore.ts / controlDb.ts split, applied again;
// routes/notes.ts is the counter-example, where inlining everything made the
// whole file permanently unreachable from a test.
//
// A saved view stores the URL QUERY STRING, not structured JSON. urlSync stays
// the single codec, so a saved view can never drift from what the URL is
// capable of expressing. (That is also why the four unserialized filter
// dimensions had to be fixed first — otherwise saving would silently lose
// them.)

import type { SavedViewDTO } from '../shared/types.js'

export interface SavedViewRow {
  id: number
  name: string
  query: string
  sort_order: number
  created_at: number
  updated_at: number
}

export const NAME_MAX = 80
/** Generous next to a realistic query (a few hundred chars even with many
 *  prefix groups selected), tight enough to bound a row. Over-length is
 *  rejected rather than truncated — a silently clipped query would restore a
 *  DIFFERENT view, which is worse than a visible error. */
export const QUERY_MAX = 4000

/**
 * Params that must never survive into a saved view.
 *
 * `w` — the workspace. A view lives in its workspace's own graph.db, so its
 * workspace is implied; carrying `w` would teleport whoever opens it from
 * another workspace.
 *
 * `focus` / `detail` / `chain` / `note` / `notes` — pointers at one specific
 * record. A saved *view* is a filter and layout snapshot, not a bookmark to an
 * issue. Stripping them also sidesteps dangling ids: those records may have
 * aged out of the cache window, and the "chain root not found" escape hatch in
 * GraphCanvas only renders in the dependency view, so a saved project-view
 * with a dead chain would otherwise show a blank canvas with no explanation.
 */
export const STRIPPED_PARAMS = ['w', 'focus', 'detail', 'chain', 'note', 'notes']

export function normalizeSavedViewName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (name.length === 0 || name.length > NAME_MAX) return null
  return name
}

/**
 * Validate and clean a query string.
 *
 * This is a security boundary, not just tidying: recall feeds the result to
 * `history.pushState`, so anything that could read as a URL rather than a query
 * string is an open-redirect primitive. Absolute URLs, protocol-relative
 * `//host` forms and backslash variants are rejected outright rather than
 * escaped, because there is no legitimate reason for one to appear here.
 *
 * Returns null when the input is unusable.
 */
export function normalizeSavedViewQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let q = raw.trim()
  if (q.length > QUERY_MAX) return null
  if (q.startsWith('?')) q = q.slice(1)
  // Reject anything shaped like a URL rather than a query string.
  if (q.includes('://') || q.includes('\\')) return null
  if (q.startsWith('/')) return null

  const params = new URLSearchParams(q)
  for (const key of STRIPPED_PARAMS) params.delete(key)
  // Re-serialize so only well-formed pairs survive; anything URLSearchParams
  // could not parse is dropped rather than passed through.
  const out = params.toString()
  if (out.length > QUERY_MAX) return null
  return out
}

export function savedViewRowToDTO(row: SavedViewRow): SavedViewDTO {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Next sort_order for an appended view. Views read top-to-bottom in creation
 *  order, unlike notes which insert newest-first. */
export function nextSortOrder(rows: Pick<SavedViewRow, 'sort_order'>[]): number {
  let max = -1
  for (const r of rows) if (r.sort_order > max) max = r.sort_order
  return max + 1
}
