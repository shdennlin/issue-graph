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
