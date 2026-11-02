import { describe, it, expect } from 'vitest'
import { fuzzyScore, fuzzyMatch, fuzzyIndices } from './fuzzyMatch'

describe('fuzzyScore', () => {
  it('returns null when query chars are not all present in order', () => {
    expect(fuzzyScore('xyz', 'abc')).toBeNull()
    expect(fuzzyScore('cba', 'abc')).toBeNull()
  })

  it('returns a positive score for a subsequence match', () => {
    expect(fuzzyScore('abc', 'aXbXc')).not.toBeNull()
  })

  it('scores prefix matches higher than mid-string matches', () => {
    const prefix = fuzzyScore('log', 'login crash')!
    const mid = fuzzyScore('log', 'fix login')!
    expect(prefix).toBeGreaterThan(mid)
  })

  it('scores word-boundary hits higher than mid-word hits', () => {
    const boundary = fuzzyScore('fc', 'fix crash')!
    const midword = fuzzyScore('fc', 'efficacious')!
    expect(boundary).toBeGreaterThan(midword)
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('ABC', 'abc')).toEqual(fuzzyScore('abc', 'abc'))
  })

  it('treats empty query as a match with zero score', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})

describe('fuzzyMatch (with id-prefix bonus)', () => {
  it('boosts items whose identifier starts with the query', () => {
    const withId = fuzzyMatch('one', { label: 'ONE-1 login', identifier: 'ONE-1' })!
    const without = fuzzyMatch('one', { label: 'phone is broken', identifier: null })!
    expect(withId).toBeGreaterThan(without)
  })

  it('returns null when the query matches neither label nor identifier', () => {
    expect(fuzzyMatch('zzz', { label: 'login crash', identifier: 'ONE-1' })).toBeNull()
  })
})

// Reported: typing "393" listed ONE-329 and ONE-349 above ONE-393.
//
// The id bonus only fired on `identifier.startsWith(query)`, and identifiers
// begin with the team prefix — so typing the number, the most natural way to
// reach an issue, was the one way that never earned it. ONE-393 then competed
// on fuzzy score alone and lost to issues that happened to scatter a 3, a 9 and
// a 3 across their titles with word-boundary bonuses on the way.
describe('fuzzyMatch — reaching an issue by its number', () => {
  const target = (identifier: string, title: string) => ({
    label: `${identifier} ${title}`,
    identifier,
  })

  const exact = target('ONE-393', 'core-api: `FAILED` state never cleared')
  // Both really do match "393" as a subsequence, via the digits in their own
  // identifiers and a "3" later in the title.
  const scatterA = target('ONE-329', '[2/3] Live attack-chain: full path')
  const scatterB = target('ONE-349', '[ONE-343] Generalize the retry budget')

  it('ranks the issue whose number was typed above coincidental matches', () => {
    const hit = fuzzyMatch('393', exact)!
    // A coincidence may now be dropped outright (null) instead of merely ranked
    // lower — either way it does not outrank the issue that was named.
    for (const other of [fuzzyMatch('393', scatterA), fuzzyMatch('393', scatterB)]) {
      if (other !== null) expect(hit).toBeGreaterThan(other)
    }
  })

  it('still ranks a full identifier highest of all', () => {
    expect(fuzzyMatch('ONE-393', exact)!).toBeGreaterThan(fuzzyMatch('393', exact)!)
  })

  it('accepts a partial number', () => {
    expect(fuzzyMatch('39', exact)!).toBeGreaterThan(fuzzyMatch('39', scatterA)!)
  })

  // The guard that keeps the bonus from swallowing ordinary word searches: a
  // query that is not addressing an identifier must not collect it. Every
  // issue's identifier starts with the team prefix, so without this, typing a
  // team name would drown every note and tab in the palette.
  it('does not fire for a word that happens to prefix every identifier', () => {
    const issue = target('ONE-1', 'login crash')
    const note = { label: 'one-pager for the migration', identifier: null }
    expect(fuzzyMatch('one', note)!).toBeGreaterThan(fuzzyMatch('one', issue)! - 300)
  })

  it('does not match an issue whose number merely contains the query elsewhere', () => {
    // "93" is inside "393" but not at its start; scoring it as a number hit
    // would make every three-digit issue a candidate for every two-digit query.
    const other = target('ONE-100', 'unrelated')
    expect(fuzzyMatch('93', other)).toBeNull()
  })
})

// Reported: "jq" listed ONE-342 "Form injection tools reuse a stale anti-CSRF
// token — no per-request…" with nothing to say why. j in "injection" and q in
// "request" are thirty characters apart: a subsequence, not a resemblance.
describe('fuzzy — scattered coincidences', () => {
  const title = 'ONE-342 Form injection tools reuse a stale anti-CSRF token — no per-request token'

  it('rejects a match whose characters are far apart and not on word boundaries', () => {
    expect(fuzzyScore('jq', title)).toBeNull()
    expect(fuzzyMatch('jq', { label: title, identifier: 'ONE-342' })).toBeNull()
  })

  it('still matches abbreviations that land on word boundaries', () => {
    expect(fuzzyScore('qsw', 'Quick Switcher palette')).not.toBeNull()
    expect(fuzzyScore('gh', 'get-handler')).not.toBeNull()
  })

  it('still matches a real occurrence', () => {
    expect(fuzzyScore('jq', 'parse output with jq filters')).not.toBeNull()
  })

  it('ranks a contiguous run above a scattered one', () => {
    expect(fuzzyScore('abc', 'xx abc xx')!).toBeGreaterThan(fuzzyScore('abc', 'xx a_b_c xx')!)
  })
})

describe('fuzzyIndices', () => {
  it('reports where each query character landed', () => {
    expect(fuzzyIndices('jq', 'use jq now')).toEqual([4, 5])
  })

  it('returns null when there is no tight alignment', () => {
    expect(fuzzyIndices('jq', 'injection of a request')).toBeNull()
  })

  it('picks a later start when the first one cannot be completed tightly', () => {
    expect(fuzzyIndices('jq', 'injection then jq')).toEqual([15, 16])
  })
})

// Reported (second round): "re-calls" highlighted t[h]r[e]ad-l[o]cal… across
// "thread-local, lost across ThreadPoolExecutor". Small hops, huge total span.
describe('fuzzy — total span', () => {
  const t = 'central: debug files silently drop events — collector bound to thread-local, lost across ThreadPoolExecutor boundary'

  it('rejects a match spread over several words even when each hop is short', () => {
    expect(fuzzyScore('re-calls', t)).toBeNull()
  })

  it('still allows a near-miss within the query length plus slack', () => {
    expect(fuzzyScore('recalls', 'L1 re-calls todo_write')).not.toBeNull()
  })

  it('still allows an acronym spread over word starts', () => {
    expect(fuzzyScore('qsw', 'Quick Switcher palette')).not.toBeNull()
    expect(fuzzyScore('tpe', 'Thread Pool Executor')).not.toBeNull()
  })
})
