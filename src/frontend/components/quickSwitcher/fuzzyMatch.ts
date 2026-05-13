// Tiny subsequence-based fuzzy scorer. Higher score = better match.
// Bonuses: prefix match, word-boundary hits.
// No new dependency.

const WORD_BOUNDARY = /[\s_\-\/\.:]/

/** Score `text` against `query`. Returns null when query is not a subsequence of text. */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let ti = 0
  let matchedFirstAtZero = false
  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi]
    let found = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] === qc) { found = i; break }
    }
    if (found === -1) return null
    if (qi === 0 && found === 0) matchedFirstAtZero = true
    if (found > 0 && WORD_BOUNDARY.test(t[found - 1])) score += 8
    score += Math.max(0, 10 - (found - ti)) // closer to previous match = better
    ti = found + 1
  }
  if (matchedFirstAtZero) score += 25 // prefix bonus
  return score
}

export interface FuzzyTarget {
  label: string
  /** Optional identifier (e.g. "ONE-123") for id-prefix bonus. */
  identifier: string | null
}

/** Score against label, with an extra bonus when identifier starts with the query. */
export function fuzzyMatch(query: string, target: FuzzyTarget): number | null {
  const labelScore = fuzzyScore(query, target.label)
  const idScore =
    target.identifier && target.identifier.toLowerCase().startsWith(query.toLowerCase())
      ? 50
      : 0
  if (labelScore === null && idScore === 0) return null
  return (labelScore ?? 0) + idScore
}
