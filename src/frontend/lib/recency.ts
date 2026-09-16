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

/** Facts about an issue's activity that its own `updatedAt` cannot express. */
export interface ActivityEvidence {
  /**
   * When the issue's `updatedAt` is explained entirely by a link being pointed
   * at it, the moment that happened — see `linkOnlyTouchAt`. Null or omitted
   * reads `updatedAt` at face value.
   */
  linkOnlyAt?: string | null
  /**
   * The newest `updatedAt` among this issue's children — see
   * `childActivityIndex`. Linear does not roll a sub-issue's activity up to its
   * parent, so without this a parent whose children are all moving reads as
   * untouched.
   */
  childActivityAt?: string | null
}

function timestamp(raw: string | null | undefined): number | null {
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Whether an issue falls inside the recency window.
 *
 * In 'updated' mode this asks "when did something last actually happen here",
 * which is NOT the same question as "what does `updatedAt` say". That field has
 * one slot, and a link pointed at the issue overwrites it — so a link-only bump
 * does not mean nothing happened, it means `updatedAt` can no longer testify to
 * what did. The other evidence is consulted instead: when the issue was
 * created, when it was last commented on, when a child last moved. The newest
 * of them wins.
 *
 * (Before this, a link-only bump returned false outright. Measured on a live
 * workspace, that hid 8 of the 17 issues created in the last 7 days, plus cards
 * with comments as recent as 45 seconds before the link landed.)
 *
 * 'created' mode is left alone: it is an explicit "show me new issues" request,
 * and widening it with other evidence would stop it answering that question.
 *
 * A timestamp that cannot be read is not evidence, so an issue with no readable
 * evidence at all fails the filter rather than padding a filtered view.
 */
export function passesRecency(
  issue: Pick<NormalizedIssue, 'createdAt' | 'updatedAt' | 'lastCommentAt'>,
  mode: RecencyMode,
  window: RecencyWindow,
  now: number,
  /**
   * Checked after the cutoff: with the window at 'any' the filter is off, and
   * evidence must not then be able to remove an issue from the graph.
   */
  evidence: ActivityEvidence = {},
): boolean {
  const cutoff = recencyCutoff(window, now)
  if (cutoff === null) return true
  if (mode === 'created') {
    const created = timestamp(issue.createdAt)
    return created !== null && created >= cutoff
  }
  // `updatedAt` testifies only when a link is not the whole story behind it;
  // when it is, creation is what the issue can still prove about itself.
  const own = evidence.linkOnlyAt ? timestamp(issue.createdAt) : timestamp(issue.updatedAt)
  let newest: number | null = null
  for (const t of [own, timestamp(issue.lastCommentAt), timestamp(evidence.childActivityAt)]) {
    if (t !== null && (newest === null || t > newest)) newest = t
  }
  return newest !== null && newest >= cutoff
}
