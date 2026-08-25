import { describe, expect, it } from 'vitest'
import { passesRecency, recencyCutoff, type RecencyMode, type RecencyWindow } from './recency'

// Fixed clock — 2026-08-25T14:30:00 local time. Every assertion is relative to
// this, so the suite never depends on the real time of day.
const NOW = new Date(2026, 7, 25, 14, 30, 0).getTime()
const MIDNIGHT = new Date(2026, 7, 25, 0, 0, 0, 0).getTime()
const DAY = 24 * 3600 * 1000

function issue(createdAt: number, updatedAt: number) {
  return {
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
  }
}

describe('recencyCutoff', () => {
  it('returns null for "any" so nothing is filtered', () => {
    expect(recencyCutoff('any', NOW)).toBeNull()
  })

  it('"today" is local midnight, not now minus 24h', () => {
    expect(recencyCutoff('today', NOW)).toBe(MIDNIGHT)
    expect(recencyCutoff('today', NOW)).not.toBe(NOW - DAY)
  })

  it('"today" is stable regardless of the time of day it is evaluated', () => {
    const morning = new Date(2026, 7, 25, 6, 0, 0).getTime()
    const night = new Date(2026, 7, 25, 23, 59, 0).getTime()
    expect(recencyCutoff('today', morning)).toBe(recencyCutoff('today', night))
  })

  it('rolling windows are exact multiples of 24h', () => {
    expect(recencyCutoff('7d', NOW)).toBe(NOW - 7 * DAY)
    expect(recencyCutoff('30d', NOW)).toBe(NOW - 30 * DAY)
  })
})

describe('passesRecency', () => {
  it('"any" admits everything, however old', () => {
    const ancient = issue(0, 0)
    expect(passesRecency(ancient, 'updated', 'any', NOW)).toBe(true)
    expect(passesRecency(ancient, 'created', 'any', NOW)).toBe(true)
  })

  it('includes an issue exactly on the boundary, excludes one 1ms before', () => {
    expect(passesRecency(issue(0, MIDNIGHT), 'updated', 'today', NOW)).toBe(true)
    expect(passesRecency(issue(0, MIDNIGHT - 1), 'updated', 'today', NOW)).toBe(false)
  })

  it('reads createdAt or updatedAt according to the mode', () => {
    // Created long ago, updated this morning — the classic "old issue that
    // just moved" case the filter exists for.
    const touched = issue(NOW - 90 * DAY, NOW - 3600 * 1000)
    expect(passesRecency(touched, 'updated', 'today', NOW)).toBe(true)
    expect(passesRecency(touched, 'created', 'today', NOW)).toBe(false)
  })

  const cases: Array<[RecencyWindow, number, boolean]> = [
    ['7d', 3 * DAY, true],
    ['7d', 10 * DAY, false],
    ['30d', 10 * DAY, true],
    ['30d', 45 * DAY, false],
  ]
  it.each(cases)('window %s with an issue %dms old → %s', (window, age, expected) => {
    const i = issue(NOW - age, NOW - age)
    expect(passesRecency(i, 'updated', window, NOW)).toBe(expected)
  })

  it('rejects rather than admits an unparseable timestamp', () => {
    const broken = { createdAt: 'not-a-date', updatedAt: 'not-a-date' }
    expect(passesRecency(broken, 'updated', '7d', NOW)).toBe(false)
    // …but 'any' still short-circuits before parsing.
    expect(passesRecency(broken, 'updated', 'any', NOW)).toBe(true)
  })

  const modes: RecencyMode[] = ['created', 'updated']
  it.each(modes)('mode %s is symmetric when both timestamps match', (mode) => {
    const i = issue(NOW - DAY, NOW - DAY)
    expect(passesRecency(i, mode, '7d', NOW)).toBe(true)
    expect(passesRecency(i, mode, 'today', NOW)).toBe(false)
  })
})
