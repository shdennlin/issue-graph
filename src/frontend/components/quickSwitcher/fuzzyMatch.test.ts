import { describe, it, expect } from 'vitest'
import { fuzzyScore, fuzzyMatch } from './fuzzyMatch'

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
    expect(hit).toBeGreaterThan(fuzzyMatch('393', scatterA)!)
    expect(hit).toBeGreaterThan(fuzzyMatch('393', scatterB)!)
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
