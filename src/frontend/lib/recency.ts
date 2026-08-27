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
//   - every other window is a rolling span (now − N hours/days), matching how
//     `staleDays` already computes its cutoff in views/filters.ts.
// Running the same filter at 09:00 and at 23:00 therefore gives a stable
// answer for 'today', which a rolling 24h window would not — which is why
// both are offered rather than one standing in for the other.

import type { NormalizedIssue } from '@shared/types.js'

export type RecencyMode = 'created' | 'updated'

/**
 * A window is either a calendar concept or a rolling `<amount><unit>` span.
 *
 * Grammar rather than enum, so any span is expressible without a schema
 * change. The original values happened to be written `7d` / `30d` rather than
 * `week` / `month`, so they already parse under the wider rule and no
 * migration was needed — a naming choice paying off years later.
 */
export type RecencyWindow = 'any' | 'today' | `${number}h` | `${number}d`

/** Offered as one-click choices. Any other valid span is reachable by typing. */
export const RECENCY_PRESETS: RecencyWindow[] = ['any', '1h', '24h', 'today', '7d', '30d']
export const RECENCY_MODES: RecencyMode[] = ['updated', 'created']

const HOUR_MS = 3600 * 1000
const DAY_MS = 24 * HOUR_MS

/** Bounds on a typed span. A year is past the point where "recent" means
 *  anything, and the cap keeps a stray paste from producing a silly cutoff. */
export const MAX_HOURS = 8760
export const MAX_DAYS = 365

const SPAN = /^(\d+)([hd])$/

/**
 * Validate a window string, returning null for anything unrecognised.
 *
 * Deliberately strict: `${number}` in the type also admits `1.5`, `-2` and
 * `1e3`, so the type is a guardrail and this is the gate.
 */
export function parseRecencyWindow(raw: unknown): RecencyWindow | null {
  if (raw !== 'any' && raw !== 'today' && typeof raw !== 'string') return null
  if (raw === 'any' || raw === 'today') return raw
  const m = SPAN.exec(raw as string)
  if (!m) return null
  const amount = Number(m[1])
  const unit = m[2]
  if (!Number.isInteger(amount) || amount < 1) return null
  if (unit === 'h' && amount > MAX_HOURS) return null
  if (unit === 'd' && amount > MAX_DAYS) return null
  return raw as RecencyWindow
}

/**
 * Earliest timestamp that still counts as "recent" for a window.
 * Returns null for 'any' — and for anything unparseable, so a bad value fails
 * open rather than hiding every issue.
 */
export function recencyCutoff(window: RecencyWindow, now: number): number | null {
  if (window === 'any') return null
  if (window === 'today') {
    // A calendar concept, not a rolling span: at 09:00 "today" covers nine
    // hours, where "24h" would reach back into yesterday evening. Both are
    // offered because they answer different questions.
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const m = SPAN.exec(window)
  if (!m) return null
  const amount = Number(m[1])
  return now - amount * (m[2] === 'h' ? HOUR_MS : DAY_MS)
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
