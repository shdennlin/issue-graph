// What the Workstreams manager shows, as pure functions: rows in, rows out.
//
// Lives here rather than in WorkstreamsPanel.tsx because `.tsx` is outside
// vitest's glob — a search rule decided inside the component could not be
// tested at all.

export interface ListRow {
  id: number
  name: string
  summary: string | null
  stage: string | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  status: 'active' | 'archived'
  /** When it arrived at its CURRENT stage. Not on the summary endpoint — the
   *  caller joins it in from the graph payload — so absent means "unknown",
   *  and sorts like having no stage. */
  stageEnteredAt?: number | null
}

/** One dimension, one control: which side of the archive line to show. Kept as a
 *  single value rather than two booleans ("show archived" + "only archived"),
 *  because two flags over one dimension can be set against each other. */
export type Scope = 'active' | 'all' | 'archived'

export type SortKey = 'updated' | 'created' | 'name' | 'onStage'

/** `null` is "any stage". `''` is "no stage at all" — a real answer, the one
 *  that finds what was never put on the pipeline, so it cannot double as
 *  "unfiltered". */
export type StageFilter = string | null

/**
 * Case-insensitive substring over everything a person can read on the row: the
 * full name, the note's first line, and the id (`#12`, or just `12`). Every
 * whitespace-separated term has to match somewhere, so "agent manifest" finds
 * "Agent manifest unification" without the words having to be adjacent.
 * Empty query matches everything.
 */
export function matchesQuery(query: string, row: ListRow): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = `${row.name}\n${row.summary ?? ''}\n#${row.id}`.toLowerCase()
  return terms.every((term) => hay.includes(term))
}

/**
 * Newest first for both dates, A–Z for names. An archived row sorts on the date
 * it was archived under `updated`: that is when it last changed in any way a
 * person did, and it is the date the row shows.
 */
export function sortRows<T extends ListRow>(rows: readonly T[], key: SortKey): T[] {
  const lastTouched = (r: ListRow) => r.archivedAt ?? r.updatedAt
  const out = [...rows]
  if (key === 'onStage') {
    // Longest on its stage first = EARLIEST arrival first. Rows with no live
    // stage (never staged, archived, or no arrival time) go last: they are not
    // stuck, they are elsewhere, and putting them first would bury the answer.
    const arrived = (r: ListRow) =>
      r.status === 'archived' || r.stage === null || r.stageEnteredAt == null ? null : r.stageEnteredAt
    out.sort((a, b) => {
      const x = arrived(a)
      const y = arrived(b)
      if (x === null && y === null) return b.id - a.id
      if (x === null) return 1
      if (y === null) return -1
      return x - y || b.id - a.id
    })
  } else if (key === 'name') out.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
  else if (key === 'created') out.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
  else out.sort((a, b) => lastTouched(b) - lastTouched(a) || b.id - a.id)
  return out
}

export function visibleRows<T extends ListRow>(
  rows: readonly T[],
  opts: { query: string; stage: StageFilter; sort: SortKey; scope: Scope },
): T[] {
  const kept = rows.filter(
    (r) =>
      (opts.scope === 'all' || (opts.scope === 'archived') === (r.status === 'archived')) &&
      matchesQuery(opts.query, r) &&
      (opts.stage === null || (r.stage ?? '') === opts.stage),
  )
  return sortRows(kept, opts.sort)
}
