// Recency ("what moved lately") filtering.
//
// Complements `Filters.staleOnly`, which is the inverse: stale = *not* updated
// since a cutoff, recency = updated (or created) *since* one. Both are kept —
// staleOnly is already serialized into shared URLs and removing it would break
// existing links.
//
// Boundary semantics, deliberately not uniform:
//   - 'today' is a calendar concept, so it means "since local midnight".
//     Using setHours(0,0,0,0) rather than now-24h also makes it DST-safe.
//   - '7d' / '30d' are rolling windows (now − N×24h), matching how
//     `staleDays` already computes its cutoff in views/filters.ts.
// Running the same filter at 09:00 and at 23:00 therefore gives a stable
// answer for 'today', which a rolling 24h window would not.

import type { NormalizedIssue } from '@shared/types.js'

export type RecencyMode = 'created' | 'updated'
export type RecencyWindow = 'any' | 'today' | '7d' | '30d'

export const RECENCY_WINDOWS: RecencyWindow[] = ['any', 'today', '7d', '30d']
export const RECENCY_MODES: RecencyMode[] = ['updated', 'created']

const DAY_MS = 24 * 3600 * 1000

/**
 * Earliest timestamp that still counts as "recent" for a window.
 * Returns null for 'any', meaning no filtering.
 */
export function recencyCutoff(window: RecencyWindow, now: number): number | null {
  switch (window) {
    case 'any':
      return null
    case 'today': {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    case '7d':
      return now - 7 * DAY_MS
    case '30d':
      return now - 30 * DAY_MS
  }
}

/**
 * Whether an issue falls inside the recency window. An unparseable timestamp
 * fails the filter rather than passing it — a filtered view should not be
 * padded with issues whose date we could not read.
 */
export function passesRecency(
  issue: Pick<NormalizedIssue, 'createdAt' | 'updatedAt'>,
  mode: RecencyMode,
  window: RecencyWindow,
  now: number,
): boolean {
  const cutoff = recencyCutoff(window, now)
  if (cutoff === null) return true
  const raw = mode === 'created' ? issue.createdAt : issue.updatedAt
  const t = new Date(raw).getTime()
  if (!Number.isFinite(t)) return false
  return t >= cutoff
}
