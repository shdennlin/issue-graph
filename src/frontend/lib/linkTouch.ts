// Telling "this issue moved" apart from "somebody pointed at this issue".
//
// Linear bumps `Issue.updatedAt` on BOTH endpoints when a relation is drawn.
// For the issue that was linked *to*, nothing about it changed — no state, no
// assignee, no comment — yet it surfaces in "Recent activity" as though
// someone had worked on it. Measured on a live workspace, that accounted for
// 20 of the 21 noisy issues in a 7-day window; the filter was admitting more
// bystanders than movers.
//
// The discriminator is direction, not the fact of a relation. A new edge is a
// real event in a dependency graph — it is just an event about the issue that
// *drew* it. Two facts make the test cheap and near-exact:
//
//   - `relations` already rides along in the issue payload, so the timestamps
//     cost one extra field and no extra request.
//   - On the target side the bump lands on the same millisecond as the link.
//     The tolerance below exists only for burst drift, not for guessing.
//
// Known limit: relations are one-directional in the payload, so an issue is
// only known to have been pointed at if the issue doing the pointing is also
// loaded. When the source is out of scope the link is invisible here and the
// issue keeps its raw `updatedAt` — the filter degrades to today's behaviour
// rather than reporting something false.

import type { NormalizedIssue } from '@shared/types.js'

/**
 * How far `updatedAt` may sit from a link's own timestamp and still be
 * explained by it. Observed drift within a burst of links is under two
 * seconds; anything wider is a separate edit that happens to be nearby.
 */
export const LINK_TOUCH_TOLERANCE_MS = 2000

type RelationSource = Pick<NormalizedIssue, 'identifier' | 'relations'>
type Touched = Pick<NormalizedIssue, 'identifier' | 'updatedAt'>

export interface LinkTouchIndex {
  /** identifier → newest moment a relation was pointed AT this issue. */
  pointedAt: Map<string, string>
  /** identifier → newest moment this issue pointed a relation at something. */
  pointedFrom: Map<string, string>
}

export const EMPTY_LINK_TOUCH_INDEX: LinkTouchIndex = {
  pointedAt: new Map(),
  pointedFrom: new Map(),
}

function keepNewest(map: Map<string, string>, id: string, at: string): void {
  const prev = map.get(id)
  if (prev === undefined || at > prev) map.set(id, at)
}

/**
 * Index both ends of every link in the given set.
 *
 * Built from whatever issues are on hand rather than fetched separately: the
 * target side of a link is never present on the target's own record, so the
 * only way to learn that B was pointed at is to walk A.
 */
export function buildLinkTouchIndex(issues: readonly RelationSource[]): LinkTouchIndex {
  const pointedAt = new Map<string, string>()
  const pointedFrom = new Map<string, string>()
  for (const issue of issues) {
    for (const r of issue.relations) {
      // No timestamp means the row predates the field. Skipping leaves the
      // issue looking normally-updated, which is the pre-existing behaviour.
      if (!r.createdAt) continue
      keepNewest(pointedFrom, issue.identifier, r.createdAt)
      keepNewest(pointedAt, r.targetIdentifier, r.createdAt)
    }
  }
  return { pointedAt, pointedFrom }
}

/**
 * `buildLinkTouchIndex` memoized on the array it was given.
 *
 * Both consumers — the filter pass and the card's age badge — want the index
 * for the same `data.issues` array that the store hands out, and the filter
 * pass alone runs six times per keystroke through leave-one-out counting.
 * Keying on the array identity gets one build per data load without threading
 * the index through every view's signature. A WeakMap so a replaced array is
 * collectable the moment the store drops it.
 */
const memo = new WeakMap<readonly RelationSource[], LinkTouchIndex>()

export function getLinkTouchIndex(issues: readonly RelationSource[]): LinkTouchIndex {
  const hit = memo.get(issues)
  if (hit) return hit
  const built = buildLinkTouchIndex(issues)
  memo.set(issues, built)
  return built
}

function explains(updatedAt: number, at: string | undefined): boolean {
  if (at === undefined) return false
  const t = new Date(at).getTime()
  if (!Number.isFinite(t)) return false
  return Math.abs(updatedAt - t) <= LINK_TOUCH_TOLERANCE_MS
}

/**
 * The moment this issue was pointed at, if that is the whole story behind its
 * `updatedAt` — otherwise null.
 *
 * Fails open in every ambiguous case. An issue that was pointed at *and*
 * pointed outward at the same moment was being worked on, so it is not
 * flagged; neither is one whose timestamp cannot be read. Hiding a real mover
 * is the costlier mistake, and the same instinct governs `passesRecency`.
 */
export function linkOnlyTouchAt(issue: Touched, index: LinkTouchIndex): string | null {
  const at = index.pointedAt.get(issue.identifier)
  if (at === undefined) return null
  const updated = new Date(issue.updatedAt).getTime()
  if (!Number.isFinite(updated)) return null
  if (!explains(updated, at)) return null
  if (explains(updated, index.pointedFrom.get(issue.identifier))) return null
  return at
}
