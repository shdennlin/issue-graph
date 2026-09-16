// Tiny subsequence-based fuzzy scorer. Higher score = better match.
// Bonuses: prefix match, word-boundary hits.
// No new dependency.

const WORD_BOUNDARY = /[\s_\-/.:]/

/** Score `text` against `query`. Returns null when query is not a subsequence of text. */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let ti = 0
  let matchedFirstAtZero = false
  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi]!
    let found = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] === qc) { found = i; break }
    }
    if (found === -1) return null
    if (qi === 0 && found === 0) matchedFirstAtZero = true
    if (found > 0 && WORD_BOUNDARY.test(t[found - 1]!)) score += 8
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

/** The digits of "ONE-393" — what people actually type to reach an issue. */
function numberPart(identifier: string): string {
  const dash = identifier.lastIndexOf('-')
  return dash === -1 ? identifier : identifier.slice(dash + 1)
}

/**
 * Naming an issue outranks resembling one.
 *
 * These bands sit well above any fuzzy score on purpose. A subsequence match is
 * a guess about what you meant; an identifier hit is you saying it, and no
 * amount of coincidental scatter in someone else's title should outrank that.
 * Typing "393" used to lose to ONE-329, whose title happened to carry a "3"
 * after a word boundary — because the bonus only fired on `startsWith`, and
 * identifiers start with the team prefix, never the number.
 *
 * Guarded by `looksLikeIdRef` so it stays out of the way of ordinary word
 * searches. Every issue's identifier starts with the team prefix, so an
 * unguarded prefix rule would hand every issue the same large bonus the moment
 * someone typed the team name, burying every note and tab in the palette.
 */
function identifierBonus(query: string, identifier: string | null): number {
  if (!identifier) return 0
  const q = query.toLowerCase()
  const id = identifier.toLowerCase()
  if (id === q) return 400
  const looksLikeIdRef = /^\d+$/.test(q) || q.includes('-')
  if (looksLikeIdRef && (id.startsWith(q) || numberPart(id).startsWith(q))) return 300
  // The original rule, kept for the alphabetic case it was written for.
  return id.startsWith(q) ? 50 : 0
}

/** Score against the label, plus a bonus for addressing the issue by id. */
export function fuzzyMatch(query: string, target: FuzzyTarget): number | null {
  const labelScore = fuzzyScore(query, target.label)
  const idScore = identifierBonus(query, target.identifier)
  if (labelScore === null && idScore === 0) return null
  return (labelScore ?? 0) + idScore
}
