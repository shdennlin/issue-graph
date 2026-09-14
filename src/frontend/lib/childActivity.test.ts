import { describe, expect, it } from 'vitest'
import { buildChildActivityIndex, getChildActivityIndex } from './childActivity'

const iso = (t: number) => new Date(t).toISOString()
const NOW = Date.parse('2026-09-14T12:00:00.000Z')
const DAY = 86400 * 1000

function issue(identifier: string, updatedAt: number, children: string[] = []) {
  return { identifier, updatedAt: iso(updatedAt), children }
}

describe('buildChildActivityIndex', () => {
  it('maps a parent to its newest child, not its first', () => {
    const idx = buildChildActivityIndex([
      issue('A-1', NOW - 30 * DAY, ['A-2', 'A-3']),
      issue('A-2', NOW - 10 * DAY),
      issue('A-3', NOW - 2 * DAY),
    ])
    expect(idx.get('A-1')).toBe(iso(NOW - 2 * DAY))
  })

  it('leaves childless issues out entirely', () => {
    const idx = buildChildActivityIndex([issue('A-1', NOW), issue('A-2', NOW)])
    expect(idx.size).toBe(0)
  })

  // The same limit linkTouch has, and for the same reason: reporting nothing is
  // correct where reporting a guess would not be.
  it('omits a parent whose children are all outside the loaded set', () => {
    const idx = buildChildActivityIndex([issue('A-1', NOW - 30 * DAY, ['A-9'])])
    expect(idx.has('A-1')).toBe(false)
  })

  it('uses the children it can see when only some are loaded', () => {
    const idx = buildChildActivityIndex([
      issue('A-1', NOW - 30 * DAY, ['A-2', 'A-9']),
      issue('A-2', NOW - DAY),
    ])
    expect(idx.get('A-1')).toBe(iso(NOW - DAY))
  })

  it('reports the child even when the parent is newer', () => {
    // The index states a fact; deciding which timestamp wins is passesRecency's
    // job, and giving it the raw child time keeps that decision in one place.
    const idx = buildChildActivityIndex([
      issue('A-1', NOW, ['A-2']),
      issue('A-2', NOW - 30 * DAY),
    ])
    expect(idx.get('A-1')).toBe(iso(NOW - 30 * DAY))
  })

  it('rolls up one level only — a grandchild reaches its own parent', () => {
    const idx = buildChildActivityIndex([
      issue('A-1', NOW - 30 * DAY, ['A-2']),
      issue('A-2', NOW - 30 * DAY, ['A-3']),
      issue('A-3', NOW - DAY),
    ])
    expect(idx.get('A-2')).toBe(iso(NOW - DAY))
    expect(idx.get('A-1')).toBe(iso(NOW - 30 * DAY))
  })

  it('survives a parent listed as its own child without hanging', () => {
    const idx = buildChildActivityIndex([issue('A-1', NOW - DAY, ['A-1'])])
    expect(idx.get('A-1')).toBe(iso(NOW - DAY))
  })
})

describe('getChildActivityIndex', () => {
  it('returns the same index for the same array', () => {
    const issues = [issue('A-1', NOW, ['A-2']), issue('A-2', NOW - DAY)]
    expect(getChildActivityIndex(issues)).toBe(getChildActivityIndex(issues))
  })

  it('rebuilds for a different array with equal contents', () => {
    const a = [issue('A-1', NOW, ['A-2']), issue('A-2', NOW - DAY)]
    const b = [issue('A-1', NOW, ['A-2']), issue('A-2', NOW - DAY)]
    expect(getChildActivityIndex(a)).not.toBe(getChildActivityIndex(b))
    expect(getChildActivityIndex(a).get('A-1')).toBe(getChildActivityIndex(b).get('A-1'))
  })
})
