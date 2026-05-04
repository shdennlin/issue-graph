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
    expect(computeChain(issues, 'A')).toEqual(new Set(['A']))
  })

  it('walks a linear chain in both directions', () => {
    // A → B → C → D (A blocks B, B blocks C, C blocks D)
    const issues = [mk('A', ['B']), mk('B', ['C']), mk('C', ['D']), mk('D'), mk('Z')]
    expect(computeChain(issues, 'C')).toEqual(new Set(['A', 'B', 'C', 'D']))
  })

  it('walks branching chains', () => {
    // A blocks B and C; B blocks D; C blocks E
    const issues = [mk('A', ['B', 'C']), mk('B', ['D']), mk('C', ['E']), mk('D'), mk('E')]
    expect(computeChain(issues, 'D')).toEqual(new Set(['A', 'B', 'C', 'D', 'E']))
  })

  it('does not cross into disjoint components', () => {
    const issues = [
      mk('A', ['B']),
      mk('B'),
      mk('X', ['Y']),
      mk('Y'),
    ]
    expect(computeChain(issues, 'A')).toEqual(new Set(['A', 'B']))
    expect(computeChain(issues, 'X')).toEqual(new Set(['X', 'Y']))
  })

  it('returns empty set when root not found', () => {
    const issues = [mk('A', ['B']), mk('B')]
    expect(computeChain(issues, 'NOPE')).toEqual(new Set())
  })

  it('ignores dangling references to issues not in the set', () => {
    const issues = [mk('A', ['GHOST']), mk('B')]
    expect(computeChain(issues, 'A')).toEqual(new Set(['A']))
  })

  it('ignores non-blocks relation types', () => {
    const issues: NormalizedIssue[] = [
      { ...mk('A'), relations: [{ type: 'related', targetIdentifier: 'B' }] },
      mk('B'),
    ]
    expect(computeChain(issues, 'A')).toEqual(new Set(['A']))
  })
})
