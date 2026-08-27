import type { Candidate } from './types'

/**
 * Rank matches, preferring the tab you are already on when scores tie.
 *
 * The tiebreak is the whole point. Candidates are built one tab at a time, and
 * `Array.prototype.sort` is stable, so an unqualified score sort left equal
 * matches in tab order — with two tabs open on the same workspace, searching
 * from the second one and pressing Enter jumped to the first tab's copy of the
 * identical issue. Nothing in the result told you why.
 *
 * Cross-tab results still matter (finding an issue you know is in the other
 * workspace is what the switcher is for), so the active tab wins ties rather
 * than winning outright.
 *
 * The scorer is injected so this stays testable without depending on how
 * fuzzyMatch happens to be tuned.
 */
export function rankCandidates(
  candidates: Candidate[],
  query: string,
  activeTabId: string | null,
  score: (c: Candidate) => number | null,
): Candidate[] {
  const scored: { c: Candidate; score: number; order: number }[] = []
  candidates.forEach((c, order) => {
    const s = score(c)
    if (s !== null) scored.push({ c, score: s, order })
  })
  const rank = (c: Candidate) => (activeTabId !== null && c.tabId === activeTabId ? 0 : 1)
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      rank(a.c) - rank(b.c) ||
      // Explicit rather than leaning on sort stability, so the order cannot
      // change if this ever runs through a different sort.
      a.order - b.order,
  )
  return scored.map((s) => s.c)
}
