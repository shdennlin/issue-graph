/**
 * Full-text match over issue descriptions. Pure — rows in, hits out — because
 * `cache.ts` imports bun:sqlite and so cannot be reached from a vitest suite
 * (see CLAUDE.md "Stack notes that bite").
 *
 * Substring, not fuzzy. The palette already does fuzzy matching on titles; for
 * body text a scattered subsequence is exactly the coincidence that made "jq"
 * match an unrelated title. A hit here is the query, verbatim, and the snippet
 * shows where.
 *
 * Several words are ANDed (every term must appear, in any order) so
 * "csrf token" finds a description that says "token ... CSRF".
 */
import type { SearchHit } from '@shared/types.js'

export interface TextRow {
  identifier: string
  description: string
}

export type TextHit = SearchHit

const CONTEXT_BEFORE = 50
const CONTEXT_AFTER = 90

function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Make a description readable as one line of plain text.
 *
 * Descriptions are markdown, and a snippet is shown raw: without this a hit
 * read "**L1 re-calls** `todo_write`", "\~22 s" and "| -- | -- |" — syntax that
 * is noise in a one-line preview. Applied before matching as well, so what is
 * searched is what is shown and the highlight ranges line up.
 *
 * Deliberately shallow (emphasis, code ticks, escapes, heading markers, table
 * rules): a single underscore or asterisk can be part of a real identifier
 * such as `todo_write`, so those are left alone.
 */
function flatten(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\|\s*:?-{2,}:?\s*)+\|?/g, ' ')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .replace(/\\([\\*_{}[\]()#+\-.!~|>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function searchDescriptions(rows: TextRow[], query: string, limit = 30): TextHit[] {
  const ts = terms(query)
  if (ts.length === 0) return []
  const scored: { hit: TextHit; score: number }[] = []
  for (const row of rows) {
    if (!row.description) continue
    const text = flatten(row.description)
    const lower = text.toLowerCase()
    // Every term must appear somewhere.
    if (!ts.every((t) => lower.includes(t))) continue

    // Anchor the snippet on the whole phrase when it occurs, else on the first term.
    const phrase = ts.join(' ')
    const anchor = lower.indexOf(phrase) !== -1 ? lower.indexOf(phrase) : lower.indexOf(ts[0]!)
    const from = Math.max(0, anchor - CONTEXT_BEFORE)
    const to = Math.min(text.length, anchor + CONTEXT_AFTER)
    const prefix = from > 0 ? '…' : ''
    const suffix = to < text.length ? '…' : ''
    const body = text.slice(from, to)
    const snippet = `${prefix}${body}${suffix}`

    const bodyLower = body.toLowerCase()
    const ranges: [number, number][] = []
    for (const t of ts) {
      for (let i = bodyLower.indexOf(t); i !== -1; i = bodyLower.indexOf(t, i + t.length)) {
        ranges.push([prefix.length + i, prefix.length + i + t.length])
      }
    }
    ranges.sort((a, b) => a[0] - b[0])
    // Merge overlaps so the UI can paint them as runs.
    const merged: [number, number][] = []
    for (const r of ranges) {
      const last = merged[merged.length - 1]
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
      else merged.push([r[0], r[1]])
    }
    // An exact-phrase hit outranks scattered terms; earlier in the text wins ties.
    const score = (lower.includes(phrase) ? 1000 : 0) - anchor
    scored.push({ hit: { identifier: row.identifier, snippet, ranges: merged }, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.hit)
}
