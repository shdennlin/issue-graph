import { describe, expect, it } from 'vitest'
import { rankCandidates } from './rankCandidates'
import type { Candidate } from './types'

const issue = (tabId: string, identifier: string): Candidate => ({
  kind: 'issue',
  id: `${tabId}:${identifier}`,
  label: `${identifier} something`,
  identifier,
  tabId,
  scopeLabel: tabId,
  hint: '',
})

// Every candidate matches equally unless the label says otherwise, so ties are
// the default and the tiebreak is what is under test.
const flat = () => 10
const byIdentifier = (want: string) => (c: Candidate) =>
  c.kind === 'issue' && c.identifier === want ? 100 : 10

describe('rankCandidates', () => {
  // The bug this exists for: candidates are built tab by tab and sort is
  // stable, so an unqualified score sort always handed ties to tab 1 — press
  // Enter in tab 2 and you were thrown to tab 1's copy of the same issue.
  it('gives ties to the active tab', () => {
    const ranked = rankCandidates(
      [issue('tab1', 'ONE-1'), issue('tab2', 'ONE-1')],
      'ONE-1',
      'tab2',
      flat,
    )
    expect(ranked[0]?.tabId).toBe('tab2')
  })

  it('still puts a better match from another tab first', () => {
    // Cross-tab search is the switcher's purpose; the active tab wins ties,
    // not the ranking outright.
    const ranked = rankCandidates(
      [issue('tab2', 'ONE-1'), issue('tab1', 'ONE-9')],
      'ONE-9',
      'tab2',
      byIdentifier('ONE-9'),
    )
    expect(ranked[0]?.tabId).toBe('tab1')
  })

  it('falls back to build order once score and tab agree', () => {
    const ranked = rankCandidates(
      [issue('tab1', 'A'), issue('tab1', 'B')],
      'x',
      'tab1',
      flat,
    )
    expect(ranked.map((c) => c.id)).toEqual(['tab1:A', 'tab1:B'])
  })

  it('drops non-matches', () => {
    const ranked = rankCandidates(
      [issue('tab1', 'A'), issue('tab1', 'B')],
      'x',
      'tab1',
      (c) => (c.id === 'tab1:B' ? 5 : null),
    )
    expect(ranked.map((c) => c.id)).toEqual(['tab1:B'])
  })

  it('ranks nothing specially when there is no active tab', () => {
    const ranked = rankCandidates(
      [issue('tab1', 'A'), issue('tab2', 'A')],
      'A',
      null,
      flat,
    )
    expect(ranked[0]?.tabId).toBe('tab1')
  })
})
