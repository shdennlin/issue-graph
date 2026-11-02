import type { SearchHit } from '@shared/types.js'
import type { Candidate } from './types'

/** A description hit attached to the candidate it belongs to. */
export interface DescriptionMatch {
  hit: SearchHit
  /** Position in the server's ranking (0 = best), for ordering hits that have
   *  no title match to rank them by. */
  order: number
}

/**
 * Attach server hits to palette candidates.
 *
 * Hits are per workspace, and a candidate belongs to a workspace only through
 * its tab, so the join is identifier + the workspace of the candidate's tab.
 * buildCandidates already keeps one candidate per workspace+identifier, so a hit
 * has at most one home.
 */
export function attachDescriptionHits(
  candidates: Candidate[],
  workspaceOfTab: (tabId: string) => string | undefined,
  hitsByWorkspace: Record<string, SearchHit[]>,
): Map<string, DescriptionMatch> {
  const byKey = new Map<string, Candidate>()
  for (const c of candidates) {
    if (c.kind !== 'issue') continue
    const wid = workspaceOfTab(c.tabId)
    if (wid) byKey.set(`${wid}:${c.identifier}`, c)
  }
  const out = new Map<string, DescriptionMatch>()
  for (const [wid, hits] of Object.entries(hitsByWorkspace)) {
    hits.forEach((hit, order) => {
      const c = byKey.get(`${wid}:${hit.identifier}`)
      if (c) out.set(c.id, { hit, order })
    })
  }
  return out
}

/**
 * Score for a candidate matched only by its description. Below every title
 * match (those are >= 0) so body text never outranks a title the reader is
 * plausibly naming, and ordered among themselves by the server's ranking.
 */
export function descriptionOnlyScore(order: number): number {
  return -1 - order / 1000
}
