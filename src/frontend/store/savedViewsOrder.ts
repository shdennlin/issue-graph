// Pure reorder arithmetic for the saved-views list.
//
// Split out of savedViewsStore for the usual reason in this repo: the store
// talks to the network, this does not, so the rules that are easy to get wrong
// — where an item lands, which rows actually have to be written — live where a
// test can reach them.
//
// The server has no bulk-order endpoint; reordering is N independent PATCHes
// (see routes/savedViews.ts, which already accepts `sortOrder`). Each PATCH
// bumps `updated_at`, which the menu surfaces as "updated X ago", so writing a
// row that did not move is a visible lie, not just a wasted request. That is
// what reorderPatches exists to prevent.

interface Orderable {
  id: number
  sortOrder: number
}

/**
 * Move `id` to `toIndex` and renumber the whole list densely from 0.
 *
 * `toIndex` is the position in the FINAL list, i.e. after the dragged row has
 * been lifted out — the same convention as Array.prototype.splice, and the one
 * a drop target naturally reports.
 *
 * Out-of-range targets clamp rather than drop the row: a drop past the end of
 * the list is a legitimate "put it last" gesture, not an error.
 */
export function moveInOrder<T extends Orderable>(views: T[], id: number, toIndex: number): T[] {
  const from = views.findIndex((v) => v.id === id)
  if (from === -1) return views
  const next = [...views]
  const [moved] = next.splice(from, 1)
  if (!moved) return views
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved)
  return next.map((v, i) => (v.sortOrder === i ? v : { ...v, sortOrder: i }))
}

/**
 * The minimal set of writes that takes `before` to `after`.
 *
 * Compares against the row's PREVIOUS sortOrder, not its previous index: a list
 * with gaps (0, 5, 9 — what a delete leaves behind) needs renumbering even
 * where nothing visibly moved, or the next reorder would be computed against
 * numbers the server never received.
 */
export function reorderPatches<T extends Orderable>(
  before: T[],
  after: T[],
): { id: number; sortOrder: number }[] {
  const prev = new Map(before.map((v) => [v.id, v.sortOrder]))
  const out: { id: number; sortOrder: number }[] = []
  for (const v of after) {
    if (prev.get(v.id) !== v.sortOrder) out.push({ id: v.id, sortOrder: v.sortOrder })
  }
  return out
}
