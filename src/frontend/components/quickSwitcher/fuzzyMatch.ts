// Tiny subsequence-based fuzzy scorer. Higher score = better match.
// Bonuses: prefix match, word-boundary hits.
// No new dependency.

const WORD_BOUNDARY = /[\s_\-/.:]/

/**
 * How far past the previous hit the next query character may sit before the
 * match stops being a *resemblance* and becomes coincidence.
 *
 * Without a limit "jq" matched "Form in**j**ection tools reuse a stale anti-CSRF
 * token — no per-re**q**uest", thirty-odd characters apart: technically a
 * subsequence, useless to the reader, and with nothing on screen saying why the
 * row was listed. A hit that lands on a word boundary is exempt, since that is
 * how abbreviations work ("qsw" → "Quick Switcher").
 */
const MAX_GAP = 4

/**
 * A second limit on the match as a whole. Each gap can be small and the sum
 * still be absurd: "re-calls" matched "thRead-Local, Lost" — r,e then c,a,l,l,s
 * picked up across three words, every hop within MAX_GAP, the highlight a
 * confetti of single letters. The matched span may exceed the query by at most
 * this many characters, unless every hit either starts a word or continues the
 * run before it (an acronym, where the spread is the point: "qsw" → "Quick
 * Switcher", whose w just follows the s). "re-calls" fails that too: its c and
 * "-" land mid-word, apart from the previous hit.
 */
const MAX_SLACK = 4

function isWordStart(t: string, i: number): boolean {
  return i === 0 || WORD_BOUNDARY.test(t[i - 1]!)
}

function spanOk(t: string, idx: number[], qlen: number): boolean {
  const span = idx[idx.length - 1]! - idx[0]! + 1
  if (span <= qlen + MAX_SLACK) return true
  return idx.every((i, k) => isWordStart(t, i) || (k > 0 && i === idx[k - 1]! + 1))
}

/**
 * Where each query character lands in `text`, or null when there is no
 * alignment that respects MAX_GAP. Tries every start position of the first
 * character and keeps the best-scoring alignment, because the leftmost start is
 * not always the one with a tight run behind it.
 */
export function fuzzyIndices(query: string, text: string): number[] | null {
  if (query.length === 0) return []
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let best: { idx: number[]; score: number } | null = null
  for (let start = t.indexOf(q[0]!); start !== -1; start = t.indexOf(q[0]!, start + 1)) {
    const idx = [start]
    let ti = start + 1
    let ok = true
    for (let qi = 1; qi < q.length; qi++) {
      const qc = q[qi]!
      let found = -1
      for (let i = ti; i < t.length; i++) {
        if (t[i] !== qc) continue
        if (i - ti <= MAX_GAP || WORD_BOUNDARY.test(t[i - 1]!)) { found = i; break }
        // Past the window and not on a boundary: keep scanning, a later
        // occurrence may still sit on one.
      }
      if (found === -1) { ok = false; break }
      idx.push(found)
      ti = found + 1
    }
    if (!ok || !spanOk(t, idx, q.length)) continue
    const score = scoreIndices(t, idx, q)
    if (!best || score > best.score) best = { idx, score }
  }
  return best ? best.idx : null
}

function scoreIndices(t: string, idx: number[], q: string): number {
  let score = 0
  let ti = 0
  for (let qi = 0; qi < idx.length; qi++) {
    const found = idx[qi]!
    if (found > 0 && WORD_BOUNDARY.test(t[found - 1]!)) score += 8
    score += Math.max(0, 10 - (found - ti)) // closer to previous match = better
    ti = found + 1
  }
  if (idx[0] === 0) score += 25 // prefix bonus
  // A contiguous run is what the reader typed; scatter is our guess.
  if (t.includes(q)) score += 30
  return score
}

/** Score `text` against `query`. Returns null when there is no tight-enough subsequence match. */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0
  const idx = fuzzyIndices(query, text)
  if (!idx) return null
  return scoreIndices(text.toLowerCase(), idx, query.toLowerCase())
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
