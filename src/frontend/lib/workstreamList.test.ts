import { describe, expect, it } from 'vitest'
import { matchesQuery, sortRows, visibleRows, type ListRow } from './workstreamList'

const row = (over: Partial<ListRow> & { id: number }): ListRow => ({
  name: `ws ${over.id}`,
  summary: null,
  stage: null,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  status: 'active',
  ...over,
})

describe('matchesQuery', () => {
  const r = row({ id: 12, name: 'Agent manifest unification (ADR-034)', summary: 'Superseded: split in three' })

  it('matches everything on an empty or blank query', () => {
    expect(matchesQuery('', r)).toBe(true)
    expect(matchesQuery('   ', r)).toBe(true)
  })
  it('is case-insensitive over the full name', () => {
    expect(matchesQuery('ADR-034', r)).toBe(true)
    expect(matchesQuery('MANIFEST', r)).toBe(true)
  })
  it('reads the summary too', () => {
    expect(matchesQuery('superseded', r)).toBe(true)
  })
  it('requires every term, in any order', () => {
    expect(matchesQuery('unification agent', r)).toBe(true)
    expect(matchesQuery('agent nonsense', r)).toBe(false)
  })
  it('finds a row by id, with or without the hash', () => {
    expect(matchesQuery('#12', r)).toBe(true)
    expect(matchesQuery('12', r)).toBe(true)
    expect(matchesQuery('#13', r)).toBe(false)
  })
})

describe('sortRows', () => {
  const rows = [
    row({ id: 1, name: 'b', createdAt: 10, updatedAt: 50 }),
    row({ id: 2, name: 'a', createdAt: 30, updatedAt: 20 }),
    row({ id: 3, name: 'c', createdAt: 20, updatedAt: 10, archivedAt: 90 }),
  ]
  it('sorts by last touched, newest first, archive date counting for an archived row', () => {
    expect(sortRows(rows, 'updated').map((r) => r.id)).toEqual([3, 1, 2])
  })
  it('sorts by created, newest first', () => {
    expect(sortRows(rows, 'created').map((r) => r.id)).toEqual([2, 3, 1])
  })
  it('sorts by name A–Z', () => {
    expect(sortRows(rows, 'name').map((r) => r.id)).toEqual([2, 1, 3])
  })
  it('does not mutate its input', () => {
    const before = rows.map((r) => r.id)
    sortRows(rows, 'name')
    expect(rows.map((r) => r.id)).toEqual(before)
  })
})

describe('visibleRows', () => {
  const rows = [
    row({ id: 1, stage: 'propose', updatedAt: 1 }),
    row({ id: 2, stage: null, updatedAt: 2 }),
    row({ id: 3, stage: 'verify', updatedAt: 3 }),
  ]
  it('null stage filter means any stage', () => {
    expect(visibleRows(rows, { query: '', stage: null, sort: 'updated', scope: 'all' }).map((r) => r.id)).toEqual([3, 2, 1])
  })
  it("'' finds only the rows with no stage", () => {
    expect(visibleRows(rows, { query: '', stage: '', sort: 'updated', scope: 'all' }).map((r) => r.id)).toEqual([2])
  })
  it('combines query and stage', () => {
    expect(visibleRows(rows, { query: '#3', stage: 'propose', sort: 'updated', scope: 'all' })).toEqual([])
    expect(visibleRows(rows, { query: '#3', stage: 'verify', sort: 'updated', scope: 'all' }).map((r) => r.id)).toEqual([3])
  })
  it('scopes to the active side, the archived side, or both', () => {
    const mixed = [
      row({ id: 1 }),
      row({ id: 2, status: 'archived', archivedAt: 5 }),
      row({ id: 3 }),
    ]
    const ids = (scope: 'active' | 'all' | 'archived') =>
      visibleRows(mixed, { query: '', stage: null, sort: 'name', scope }).map((r) => r.id)
    expect(ids('active')).toEqual([1, 3])
    expect(ids('archived')).toEqual([2])
    expect(ids('all')).toEqual([1, 2, 3])
  })
})

describe('sortRows onStage', () => {
  const rows = [
    row({ id: 1, stage: 'verify', stageEnteredAt: 300 }),
    row({ id: 2, stage: 'discuss', stageEnteredAt: 100 }),
    row({ id: 3, stage: null, stageEnteredAt: null }),
    row({ id: 4, stage: 'discuss', stageEnteredAt: 200, status: 'archived', archivedAt: 9 }),
    row({ id: 5, stage: 'verify', stageEnteredAt: 200 }),
  ]
  it('puts the longest on its stage first', () => {
    expect(sortRows(rows, 'onStage').map((r) => r.id).slice(0, 3)).toEqual([2, 5, 1])
  })
  it('puts rows with no live stage last — unstaged, archived, or no arrival time', () => {
    const order = sortRows([...rows, row({ id: 6, stage: 'verify' })], 'onStage').map((r) => r.id)
    expect(order.slice(0, 3)).toEqual([2, 5, 1])
    expect(order.slice(3)).toEqual([6, 4, 3])
  })
})
