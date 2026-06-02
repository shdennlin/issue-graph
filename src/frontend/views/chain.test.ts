import { describe, it, expect } from 'vitest'
import { computeChain, computeChains } from './chain'
import type { NormalizedIssue } from '@shared/types.js'

function mk(id: string, blocks: string[] = []): NormalizedIssue {
  return {
    id,
    identifier: id,
    title: id,
    url: '',
    priority: 0,
    state: { name: 'Backlog', type: 'backlog' },
    assignee: null,
    labels: [],
    parent: null,
    children: [],
    relations: blocks.map((t) => ({ type: 'blocks' as const, targetIdentifier: t })),
    createdAt: '',
    updatedAt: '',
    completedAt: null,
  }
}

describe('computeChain', () => {
  it('returns just the root for an isolated issue', () => {
    const issues = [mk('A'), mk('B'), mk('C')]
    const r = computeChain(issues, 'A')
    expect(r.members).toEqual(new Set(['A']))
    expect(r.dangling).toEqual(new Set())
  })

  it('walks a linear chain in both directions', () => {
    // A → B → C → D (A blocks B, B blocks C, C blocks D)
    const issues = [mk('A', ['B']), mk('B', ['C']), mk('C', ['D']), mk('D'), mk('Z')]
    const r = computeChain(issues, 'C')
    expect(r.members).toEqual(new Set(['A', 'B', 'C', 'D']))
    expect(r.dangling).toEqual(new Set())
  })

  it('walks branching chains', () => {
    // A blocks B and C; B blocks D; C blocks E
    const issues = [mk('A', ['B', 'C']), mk('B', ['D']), mk('C', ['E']), mk('D'), mk('E')]
    const r = computeChain(issues, 'D')
    expect(r.members).toEqual(new Set(['A', 'B', 'C', 'D', 'E']))
    expect(r.dangling).toEqual(new Set())
  })

  it('does not cross into disjoint components', () => {
    const issues = [
      mk('A', ['B']),
      mk('B'),
      mk('X', ['Y']),
      mk('Y'),
    ]
    expect(computeChain(issues, 'A').members).toEqual(new Set(['A', 'B']))
    expect(computeChain(issues, 'X').members).toEqual(new Set(['X', 'Y']))
  })

  it('returns empty result when root not found', () => {
    const issues = [mk('A', ['B']), mk('B')]
    const r = computeChain(issues, 'NOPE')
    expect(r.members).toEqual(new Set())
    expect(r.dangling).toEqual(new Set())
  })

  it('records dangling references to issues not in the cache', () => {
    // A blocks B (cached) and GHOST + GHOST2 (not cached). Members = {A, B};
    // dangling = {GHOST, GHOST2}.
    const issues = [mk('A', ['B', 'GHOST', 'GHOST2']), mk('B')]
    const r = computeChain(issues, 'A')
    expect(r.members).toEqual(new Set(['A', 'B']))
    expect(r.dangling).toEqual(new Set(['GHOST', 'GHOST2']))
  })

  it('records dangling refs found while walking deeper into the chain', () => {
    // A → B → GHOST. Members = {A, B}; dangling = {GHOST}.
    const issues = [mk('A', ['B']), mk('B', ['GHOST'])]
    const r = computeChain(issues, 'A')
    expect(r.members).toEqual(new Set(['A', 'B']))
    expect(r.dangling).toEqual(new Set(['GHOST']))
  })

  it('opt-in: 1-hop related neighbors expand members', () => {
    // A blocks B (chain). B has 'related' to X (not in chain by default).
    // With includeRelatedNeighbors, X joins. C (no link to chain) stays out.
    const issues: NormalizedIssue[] = [
      mk('A', ['B']),
      { ...mk('B'), relations: [{ type: 'related', targetIdentifier: 'X' }] },
      mk('X'),
      mk('C'),
    ]
    expect(computeChain(issues, 'A').members).toEqual(new Set(['A', 'B']))
    const expanded = computeChain(issues, 'A', { includeRelatedNeighbors: true })
    expect(expanded.members).toEqual(new Set(['A', 'B', 'X']))
  })

  it('related expansion is only 1 hop (does not recurse)', () => {
    // A blocks B. B related X. X related Y. Only X joins, not Y.
    const issues: NormalizedIssue[] = [
      mk('A', ['B']),
      { ...mk('B'), relations: [{ type: 'related', targetIdentifier: 'X' }] },
      { ...mk('X'), relations: [{ type: 'related', targetIdentifier: 'Y' }] },
      mk('Y'),
    ]
    expect(computeChain(issues, 'A', { includeRelatedNeighbors: true }).members).toEqual(
      new Set(['A', 'B', 'X']),
    )
  })

  it('related expansion does not affect dangling count (blocks-only)', () => {
    // A blocks B (in cache) + GHOST (not in cache). B related X.
    // Dangling should be { GHOST } regardless of related expansion.
    const issues: NormalizedIssue[] = [
      mk('A', ['B', 'GHOST']),
      { ...mk('B'), relations: [{ type: 'related', targetIdentifier: 'X' }] },
      mk('X'),
    ]
    const r = computeChain(issues, 'A', { includeRelatedNeighbors: true })
    expect(r.members).toEqual(new Set(['A', 'B', 'X']))
    expect(r.dangling).toEqual(new Set(['GHOST']))
  })

  it('ignores non-blocks relation types', () => {
    const issues: NormalizedIssue[] = [
      { ...mk('A'), relations: [{ type: 'related', targetIdentifier: 'B' }] },
      mk('B'),
    ]
    const r = computeChain(issues, 'A')
    expect(r.members).toEqual(new Set(['A']))
    expect(r.dangling).toEqual(new Set())
  })
})

describe('computeChains (multi-root)', () => {
  it('returns empty result for no roots', () => {
    const issues = [mk('A', ['B']), mk('B')]
    const r = computeChains(issues, [])
    expect(r.members).toEqual(new Set())
    expect(r.dangling).toEqual(new Set())
  })

  it('matches computeChain for a single root', () => {
    const issues = [mk('A', ['B']), mk('B', ['C']), mk('C'), mk('Z')]
    expect(computeChains(issues, ['B'])).toEqual(computeChain(issues, 'B'))
  })

  it('unions the chains of two disjoint components', () => {
    const issues = [
      mk('A', ['B']),
      mk('B'),
      mk('X', ['Y']),
      mk('Y'),
      mk('Z'),
    ]
    const r = computeChains(issues, ['A', 'X'])
    expect(r.members).toEqual(new Set(['A', 'B', 'X', 'Y']))
    expect(r.dangling).toEqual(new Set())
  })

  it('de-duplicates overlapping chains (roots in the same component)', () => {
    // A → B → C → D ; rooting on B and D yields the same single component once.
    const issues = [mk('A', ['B']), mk('B', ['C']), mk('C', ['D']), mk('D')]
    const r = computeChains(issues, ['B', 'D'])
    expect(r.members).toEqual(new Set(['A', 'B', 'C', 'D']))
  })

  it('skips roots not present in the issue set but keeps the rest', () => {
    const issues = [mk('A', ['B']), mk('B')]
    const r = computeChains(issues, ['A', 'NOPE'])
    expect(r.members).toEqual(new Set(['A', 'B']))
    expect(r.dangling).toEqual(new Set())
  })

  it('accumulates dangling refs across all roots', () => {
    const issues = [mk('A', ['GHOST1']), mk('X', ['GHOST2'])]
    const r = computeChains(issues, ['A', 'X'])
    expect(r.members).toEqual(new Set(['A', 'X']))
    expect(r.dangling).toEqual(new Set(['GHOST1', 'GHOST2']))
  })

  it('applies includeRelatedNeighbors across roots', () => {
    const issues: NormalizedIssue[] = [
      mk('A', ['B']),
      { ...mk('B'), relations: [{ type: 'related', targetIdentifier: 'R' }] },
      mk('R'),
      mk('X', ['Y']),
      mk('Y'),
    ]
    const r = computeChains(issues, ['A', 'X'], { includeRelatedNeighbors: true })
    expect(r.members).toEqual(new Set(['A', 'B', 'R', 'X', 'Y']))
  })
})
