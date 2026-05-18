import type { NormalizedIssue } from '@shared/types.js'

/** Default bezier curvature for container-view edges. Slightly higher than
 *  RF's built-in 0.25 so the arc has more swing. */
const BASE_CURVATURE = 0.4
/** When a source fans out to multiple targets, curvature is spread across
 *  this range so the per-edge bezier paths don't all overlap. Lower bound
 *  is gentler than RF default; upper bound is a noticeable arc but not so
 *  dramatic that the edge bows past adjacent cards.
 *
 *  Caveat: RF's bezier algorithm only consults curvature when the target is
 *  "behind" the source in flow direction (distance < 0 in calculateControlOffset).
 *  For forward edges (target right of a Position.Right source) curvature is
 *  ignored — the control offset comes from raw geometry. So this helper
 *  visibly fans out *backward* multi-edges (common in container views when
 *  the grid puts a blocker to the right of its blockee) and has no effect
 *  on forward multi-edges (they remain stuck overlapping). That's a
 *  known partial fix; a fuller solution would need multiple handles per
 *  card or a custom edge component. */
const SPREAD_LOW = 0.2
const SPREAD_HIGH = 0.6

/** Compute per-edge bezier curvature, varying it across fan-out groups so
 *  the paths spread apart visually. Returns a Map keyed by `${src}->${tgt}`,
 *  matching the edge id convention used by mix/project/milestone views. */
export function fanOutCurvatures(
  issues: NormalizedIssue[],
  visibleIds: Set<string>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const i of issues) {
    if (!visibleIds.has(i.identifier)) continue
    for (const r of i.relations) {
      if (r.type !== 'blocks') continue
      if (!visibleIds.has(r.targetIdentifier)) continue
      counts.set(i.identifier, (counts.get(i.identifier) ?? 0) + 1)
    }
  }
  const seen = new Map<string, number>()
  const out = new Map<string, number>()
  for (const i of issues) {
    if (!visibleIds.has(i.identifier)) continue
    for (const r of i.relations) {
      if (r.type !== 'blocks') continue
      if (!visibleIds.has(r.targetIdentifier)) continue
      const total = counts.get(i.identifier) ?? 1
      const idx = seen.get(i.identifier) ?? 0
      seen.set(i.identifier, idx + 1)
      const id = `${i.identifier}->${r.targetIdentifier}`
      if (total <= 1) {
        out.set(id, BASE_CURVATURE)
      } else {
        out.set(id, SPREAD_LOW + (SPREAD_HIGH - SPREAD_LOW) * (idx / (total - 1)))
      }
    }
  }
  return out
}
