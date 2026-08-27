// "Which saved view am I looking at?", answered by comparing query strings
// rather than remembering the last one applied.
//
// Stateless on purpose. A remembered id would be wrong after a reload, wrong
// when someone opens a shared link that happens to match a saved view, and
// would need explicit invalidation on every filter change to avoid claiming
// you are still on a view you have since edited. Comparing the URL to each
// saved query gets all three right for free: diverge by one filter and the
// match simply stops holding.

/** Params that never take part in the comparison. Mirrors the server's
 *  STRIPPED_PARAMS — a saved query has already had these removed, and the live
 *  URL still carries them, so both sides must drop them to line up. */
const IGNORED = ['w', 'focus', 'detail', 'chain', 'note', 'notes']

/**
 * Canonical form of a query string: ignored params removed, pairs sorted.
 *
 * Sorting matters because the live URL is built in buildUrl's fixed order
 * while a saved query was re-serialized by URLSearchParams at save time; the
 * same filters can reach here as differently-ordered strings.
 */
export function canonicalQuery(raw: string): string {
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)
  for (const key of IGNORED) params.delete(key)
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return pairs.map(([k, v]) => `${k}=${v}`).join('&')
}

/** The first view whose query matches the current URL, or null when the
 *  current state does not correspond to any saved view. */
export function matchSavedView<T extends { query: string }>(
  currentSearch: string,
  views: T[],
): T | null {
  const current = canonicalQuery(currentSearch)
  return views.find((v) => canonicalQuery(v.query) === current) ?? null
}

export interface SavedViewStatus<T> {
  /** The view the label should name, or null for none. */
  view: T | null
  /** True when `view` was applied but the current state has since diverged. */
  dirty: boolean
}

/**
 * What the saved-views label should say.
 *
 * Divergence cannot be derived from the URL alone: once you edit a filter, the
 * current state matches nothing, and "matches nothing" is indistinguishable
 * from "never applied one". Naming the view you started from needs a reference
 * point, which is what `appliedId` is.
 *
 * An exact match wins over `appliedId` and is reported clean, so opening
 * someone's link that happens to equal a saved view names it correctly even
 * though this session never applied it.
 *
 * `appliedId` is session state on purpose. After a reload the state you came
 * back to is all there is; claiming you had diverged from some view would be a
 * guess.
 */
export function savedViewStatus<T extends { id: number; query: string }>(
  currentSearch: string,
  views: T[],
  appliedId: number | null,
): SavedViewStatus<T> {
  const exact = matchSavedView(currentSearch, views)
  if (exact) return { view: exact, dirty: false }
  const applied = appliedId === null ? null : (views.find((v) => v.id === appliedId) ?? null)
  return { view: applied, dirty: applied !== null }
}
