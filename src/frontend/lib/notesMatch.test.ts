import { describe, it, expect } from 'vitest'
import { matchesNote, findMatchRanges } from './notesMatch'

describe('matchesNote', () => {
  it('matches empty query against anything', () => {
    expect(matchesNote('', 'hello world')).toBe(true)
    expect(matchesNote('   ', '')).toBe(true)
  })

  it('matches against derived title (first non-empty line)', () => {
    expect(matchesNote('hello', '# Hello world\nbody text')).toBe(true)
  })

  it('matches inside the body', () => {
    expect(matchesNote('special', '# Title\n\nThis is a special phrase.')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matchesNote('HELLO', 'hello world')).toBe(true)
    expect(matchesNote('hello', 'HELLO WORLD')).toBe(true)
  })

  it('returns false on no hit', () => {
    expect(matchesNote('xyz', 'hello world')).toBe(false)
  })
})

describe('findMatchRanges', () => {
  it('returns [] for empty query', () => {
    expect(findMatchRanges('', 'hello')).toEqual([])
  })

  it('returns [] when no match', () => {
    expect(findMatchRanges('xyz', 'hello')).toEqual([])
  })

  it('finds a single hit', () => {
    expect(findMatchRanges('lo', 'hello')).toEqual([[3, 5]])
  })

  it('finds multiple non-overlapping hits', () => {
    expect(findMatchRanges('ab', 'ababab')).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ])
  })

  it('is case-insensitive but ranges reflect original text indices', () => {
    expect(findMatchRanges('HELLO', 'say hello and Hello again')).toEqual([
      [4, 9],
      [14, 19],
    ])
  })

  it('handles query at boundary', () => {
    expect(findMatchRanges('end', 'the end')).toEqual([[4, 7]])
    expect(findMatchRanges('the', 'the end')).toEqual([[0, 3]])
  })
})
