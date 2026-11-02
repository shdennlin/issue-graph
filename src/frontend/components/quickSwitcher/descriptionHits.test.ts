import { describe, it, expect } from 'vitest'
import { attachDescriptionHits, descriptionOnlyScore } from './descriptionHits'
import type { Candidate } from './types'

const issue = (tabId: string, identifier: string): Candidate => ({
  kind: 'issue', id: `${tabId}:${identifier}`, label: identifier, identifier, tabId, scopeLabel: '', hint: '',
})
const hit = (identifier: string) => ({ identifier, snippet: `…${identifier}…`, ranges: [[1, 2]] as [number, number][] })
const wid = (t: string) => ({ t1: 'w1', t2: 'w2' } as Record<string, string>)[t]

describe('attachDescriptionHits', () => {
  it('joins a hit to the candidate in the same workspace', () => {
    const m = attachDescriptionHits([issue('t1', 'ONE-1')], wid, { w1: [hit('ONE-1')] })
    expect(m.get('t1:ONE-1')?.hit.identifier).toBe('ONE-1')
  })

  it('does not join across workspaces that share an identifier', () => {
    const m = attachDescriptionHits([issue('t1', 'ONE-1'), issue('t2', 'ONE-1')], wid, { w2: [hit('ONE-1')] })
    expect([...m.keys()]).toEqual(['t2:ONE-1'])
  })

  it('drops hits for issues that are not candidates', () => {
    expect(attachDescriptionHits([issue('t1', 'ONE-1')], wid, { w1: [hit('ONE-9')] }).size).toBe(0)
  })

  it('remembers the server ranking', () => {
    const m = attachDescriptionHits([issue('t1', 'A'), issue('t1', 'B')], wid, { w1: [hit('B'), hit('A')] })
    expect(m.get('t1:B')?.order).toBe(0)
    expect(m.get('t1:A')?.order).toBe(1)
  })
})

describe('descriptionOnlyScore', () => {
  it('sits below any title score and keeps server order', () => {
    expect(descriptionOnlyScore(0)).toBeLessThan(0)
    expect(descriptionOnlyScore(0)).toBeGreaterThan(descriptionOnlyScore(1))
  })
})
