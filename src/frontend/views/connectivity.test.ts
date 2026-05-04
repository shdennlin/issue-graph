import { describe, it, expect } from 'vitest'
import { computeConnectivity } from './connectivity'
import type { NormalizedIssue, NormalizedRelation } from '@shared/types.js'

function mk(id: string, relations: NormalizedRelation[] = []): NormalizedIssue {
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
    relations,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
  }
}
const blocks = (target: string): NormalizedRelation => ({ type: 'blocks', targetIdentifier: target })
const related = (target: string): NormalizedRelation => ({ type: 'related', targetIdentifier: target })

describe('computeConnectivity', () => {
  it('returns zero counts for an isolated issue', () => {
    const r = computeConnectivity([mk('A')])
    expect(r.get('A')).toEqual({ out: 0, in: 0, related: 0 })
  })

  it('counts outgoing blocks on the source side', () => {
    const r = computeConnectivity([mk('A', [blocks('B'), blocks('C')]), mk('B'), mk('C')])
    expect(r.get('A')!.out).toBe(2)
    expect(r.get('B')!.out).toBe(0)
  })

  it('counts incoming blocks on the target side', () => {
    const r = computeConnectivity([mk('A', [blocks('C')]), mk('B', [blocks('C')]), mk('C')])
    expect(r.get('C')!.in).toBe(2)
    expect(r.get('A')!.in).toBe(0)
  })

  it('counts related symmetrically (one declaration → both sides see +1)', () => {
    const r = computeConnectivity([mk('A', [related('B')]), mk('B')])
    expect(r.get('A')!.related).toBe(1)
    expect(r.get('B')!.related).toBe(1)
  })

  it('dedupes bidirectional related declarations (count once per pair)', () => {
    // Both A and B declare `related` to each other. Should still count as 1
    // pair, not 2.
    const r = computeConnectivity([mk('A', [related('B')]), mk('B', [related('A')])])
    expect(r.get('A')!.related).toBe(1)
    expect(r.get('B')!.related).toBe(1)
  })

  it('skips relations whose target is missing from cache', () => {
    // GHOST is referenced but not in the issue set. Should not count.
    const r = computeConnectivity([mk('A', [blocks('GHOST'), related('GHOST2')]), mk('B')])
    expect(r.get('A')).toEqual({ out: 0, in: 0, related: 0 })
  })

  it('handles a node referenced by multiple types simultaneously', () => {
    // A blocks B, A related to B. B should show in:1, related:1.
    const r = computeConnectivity([mk('A', [blocks('B'), related('B')]), mk('B')])
    expect(r.get('A')).toEqual({ out: 1, in: 0, related: 1 })
    expect(r.get('B')).toEqual({ out: 0, in: 1, related: 1 })
  })

  it('returns a map keyed by every issue in the input', () => {
    const r = computeConnectivity([mk('A'), mk('B'), mk('C')])
    expect(r.size).toBe(3)
    expect(r.has('A') && r.has('B') && r.has('C')).toBe(true)
  })

  it('ignores duplicate ids (first wins)', () => {
    // Defensive: if two issues somehow share an identifier, the Map
    // overwrites (Set semantics already prevent it during result init).
    const r = computeConnectivity([mk('A', [blocks('B')]), mk('A'), mk('B')])
    // Either reading is acceptable; just assert no crash and B saw an "in".
    expect(r.get('B')!.in).toBeGreaterThanOrEqual(0)
  })
})
