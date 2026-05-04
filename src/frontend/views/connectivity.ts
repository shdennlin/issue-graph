// Per-issue connectivity counts. Used by IssueNode to render the small
// "→3 ←2 ⊸1" badge so the user can assess hub-ness at a glance without
// tracing edges around the canvas.
//
// Counts are cache-wide (over data.issues), not view-bound. A card with 5
// blockers reports 5 even if chain isolation hides 3 of them from the
// rendered edge set. Rationale: the badge is the user's "global summary";
// edges already convey local visibility.

import type { NormalizedIssue } from '@shared/types.js'

export interface ConnectivityCounts {
  /** Outgoing `blocks` edges — issues this card blocks. */
  out: number
  /** Incoming `blocks` edges — issues that block this card. */
  in: number
  /** `related` links (bidirectional, deduped per pair). */
  related: number
}

export function computeConnectivity(
  issues: NormalizedIssue[],
): Map<string, ConnectivityCounts> {
  const result = new Map<string, ConnectivityCounts>()
  const byId = new Set<string>()
  for (const i of issues) {
    byId.add(i.identifier)
    result.set(i.identifier, { out: 0, in: 0, related: 0 })
  }
  // First pass: count outgoing (blocks) and accumulate related (bidirectional
  // dedup tracked via sorted-pair key). Skip relations whose target is missing
  // from cache — those don't count toward the visible-graph hub-ness signal.
  const seenRelated = new Set<string>()
  for (const i of issues) {
    const src = result.get(i.identifier)
    if (!src) continue
    for (const r of i.relations) {
      if (!byId.has(r.targetIdentifier)) continue
      if (r.type === 'blocks') {
        src.out += 1
        const tgt = result.get(r.targetIdentifier)
        if (tgt) tgt.in += 1
      } else if (r.type === 'related') {
        const a = i.identifier
        const b = r.targetIdentifier
        const key = a < b ? `${a}~${b}` : `${b}~${a}`
        if (seenRelated.has(key)) continue
        seenRelated.add(key)
        src.related += 1
        const tgt = result.get(b)
        if (tgt && tgt !== src) tgt.related += 1
      }
    }
  }
  return result
}
