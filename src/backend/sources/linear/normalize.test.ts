import { describe, expect, it } from 'vitest'
import { normalizeIssue, normalizeRelations, normalizeLabel } from './normalize.js'

describe('normalizeRelations', () => {
  it('keeps blocks edges as-is', () => {
    const out = normalizeRelations([{ type: 'blocks', relatedIssue: { identifier: 'PROJ-2' } }])
    expect(out).toEqual([{ type: 'blocks', targetIdentifier: 'PROJ-2' }])
  })

  it('drops blocked_by edges (already represented by other side)', () => {
    const out = normalizeRelations([{ type: 'blocked_by', relatedIssue: { identifier: 'PROJ-1' } }])
    expect(out).toEqual([])
  })

  it('keeps duplicate and related symmetric edges', () => {
    const out = normalizeRelations([
      { type: 'duplicate', relatedIssue: { identifier: 'PROJ-3' } },
      { type: 'related', relatedIssue: { identifier: 'PROJ-4' } },
    ])
    expect(out).toEqual([
      { type: 'duplicate', targetIdentifier: 'PROJ-3' },
      { type: 'related', targetIdentifier: 'PROJ-4' },
    ])
  })

  it('dedupes within the same issue', () => {
    const out = normalizeRelations([
      { type: 'blocks', relatedIssue: { identifier: 'PROJ-2' } },
      { type: 'blocks', relatedIssue: { identifier: 'PROJ-2' } },
    ])
    expect(out).toEqual([{ type: 'blocks', targetIdentifier: 'PROJ-2' }])
  })

  it('handles empty / null input', () => {
    expect(normalizeRelations([])).toEqual([])
    expect(normalizeRelations(undefined)).toEqual([])
    expect(normalizeRelations(null)).toEqual([])
  })

  it('skips relations with missing targets', () => {
    expect(normalizeRelations([{ type: 'blocks', relatedIssue: null }])).toEqual([])
  })

  it('Linear pair: A blocks B, B blocked_by A → only A→B kept', () => {
    const aRels = normalizeRelations([{ type: 'blocks', relatedIssue: { identifier: 'B' } }])
    const bRels = normalizeRelations([{ type: 'blocked_by', relatedIssue: { identifier: 'A' } }])
    expect(aRels).toHaveLength(1)
    expect(bRels).toHaveLength(0)
  })
})

describe('normalizeLabel', () => {
  it('flattens parent into group', () => {
    const lab = normalizeLabel({ id: '1', name: 'foo', color: '#fff', parent: { id: 'p1', name: 'service' } })
    expect(lab.group?.name).toBe('service')
    expect(lab.group?.exclusive).toBe(true)
  })

  it('returns null group when no parent', () => {
    const lab = normalizeLabel({ id: '1', name: 'foo', color: '#fff' })
    expect(lab.group).toBeNull()
  })
})

describe('normalizeIssue', () => {
  it('coerces unknown state types to backlog', () => {
    const i = normalizeIssue({
      id: 'x',
      identifier: 'X-1',
      title: 't',
      url: 'u',
      priority: 0,
      state: { name: 'Weird', type: 'mystery' },
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    })
    expect(i.state.type).toBe('backlog')
  })

  it("translates 'cancelled' (en-GB) to 'canceled' (canonical)", () => {
    const i = normalizeIssue({
      id: 'x',
      identifier: 'X-1',
      title: 't',
      url: 'u',
      priority: 0,
      state: { name: 'Cancelled', type: 'cancelled' },
    })
    expect(i.state.type).toBe('canceled')
  })

  it('extracts children identifiers', () => {
    const i = normalizeIssue({
      id: 'x',
      identifier: 'X-1',
      title: 't',
      url: 'u',
      priority: 0,
      state: { name: 'Backlog', type: 'backlog' },
      children: { nodes: [{ identifier: 'Y-1' }, { identifier: 'Y-2' }] },
    })
    expect(i.children).toEqual(['Y-1', 'Y-2'])
  })
})
