import { describe, it, expect } from 'vitest'
import { computeChain } from './chain'
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
