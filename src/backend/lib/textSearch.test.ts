import { describe, it, expect } from 'vitest'
import { searchDescriptions } from './textSearch.js'

const rows = [
  { identifier: 'ONE-1', description: 'Pipe the output through jq to pull the id out.' },
  { identifier: 'ONE-2', description: 'Form injection tools reuse a stale token with no per-request check.' },
  { identifier: 'ONE-3', description: '' },
]

describe('searchDescriptions', () => {
  it('finds the query verbatim and says where', () => {
    const [hit] = searchDescriptions(rows, 'jq')
    expect(hit?.identifier).toBe('ONE-1')
    const [s, e] = hit!.ranges[0]!
    expect(hit!.snippet.slice(s, e)).toBe('jq')
  })

  // The reported case: "jq" must not match text where j and q merely both occur.
  it('does not match a scattered subsequence', () => {
    expect(searchDescriptions(rows, 'jq').map((h) => h.identifier)).toEqual(['ONE-1'])
  })

  it('is case-insensitive', () => {
    expect(searchDescriptions(rows, 'JQ')).toHaveLength(1)
  })

  it('ANDs several words in any order', () => {
    expect(searchDescriptions(rows, 'token stale').map((h) => h.identifier)).toEqual(['ONE-2'])
    expect(searchDescriptions(rows, 'token jq')).toEqual([])
  })

  it('ranks an exact phrase above scattered terms', () => {
    const r = [
      { identifier: 'A', description: 'token is stale here' },
      { identifier: 'B', description: 'a stale token' },
    ]
    expect(searchDescriptions(r, 'stale token').map((h) => h.identifier)).toEqual(['B', 'A'])
  })

  it('ignores empty descriptions and empty queries', () => {
    expect(searchDescriptions(rows, '   ')).toEqual([])
    expect(searchDescriptions([{ identifier: 'X', description: '' }], 'a')).toEqual([])
  })

  it('cuts a one-line snippet with ellipses around a hit deep in a long text', () => {
    const long = `${'x '.repeat(200)}NEEDLE${' y'.repeat(200)}`
    const [hit] = searchDescriptions([{ identifier: 'L', description: long }], 'needle')
    expect(hit!.snippet.startsWith('…')).toBe(true)
    expect(hit!.snippet.endsWith('…')).toBe(true)
    expect(hit!.snippet).not.toContain('\n')
    expect(hit!.snippet.length).toBeLessThan(200)
    const [s, e] = hit!.ranges[0]!
    expect(hit!.snippet.slice(s, e)).toBe('NEEDLE')
  })

  it('caps the number of results', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ identifier: `I-${i}`, description: 'has jq in it' }))
    expect(searchDescriptions(many, 'jq', 10)).toHaveLength(10)
  })
})
