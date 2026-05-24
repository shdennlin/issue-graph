import { deriveTitle } from './noteTitle'

/**
 * Case-insensitive: returns true if either the derived title or the raw
 * markdown body contains `query`. Empty query matches everything.
 */
export function matchesNote(query: string, body: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  if (deriveTitle(body).toLowerCase().includes(q)) return true
  return body.toLowerCase().includes(q)
}

/**
 * Returns non-overlapping [start, end) ranges in `text` where `query` matches,
 * case-insensitively. Empty query → no ranges.
 */
export function findMatchRanges(query: string, text: string): Array<[number, number]> {
  const q = query.toLowerCase()
  if (q.length === 0 || text.length === 0) return []
  const hay = text.toLowerCase()
  const ranges: Array<[number, number]> = []
  let from = 0
  while (from <= hay.length - q.length) {
    const i = hay.indexOf(q, from)
    if (i < 0) break
    ranges.push([i, i + q.length])
    from = i + q.length
  }
  return ranges
}
