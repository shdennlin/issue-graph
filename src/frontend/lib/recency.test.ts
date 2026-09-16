import { describe, expect, it } from 'vitest'
import {
  MAX_DAYS,
  MAX_HOURS,
  parseRecencyWindow,
  passesRecency,
  recencyCutoff,
  type RecencyMode,
  type RecencyWindow,
} from './recency'

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

describe('passesRecency — a bump that was only a link', () => {
  const bumped = issue(NOW - 90 * DAY, NOW - 3600 * 1000)
  const linkedAt = new Date(NOW - 3600 * 1000).toISOString()

  it('drops an old issue whose only recent change was being pointed at', () => {
    expect(passesRecency(bumped, 'updated', 'today', NOW, { linkOnlyAt: linkedAt })).toBe(false)
    expect(passesRecency(bumped, 'updated', 'today', NOW)).toBe(true)
  })

  it('does not touch "created" mode, which never reads updatedAt', () => {
    const born = issue(NOW - 3600 * 1000, NOW - 3600 * 1000)
    expect(passesRecency(born, 'created', 'today', NOW, { linkOnlyAt: linkedAt })).toBe(true)
  })

  it('never hides anything while the window is "any"', () => {
    // The guard that keeps this a recency concern rather than a global one:
    // with no window set the filter is off, so a link-only bump must not
    // remove the issue from the graph entirely.
    expect(passesRecency(bumped, 'updated', 'any', NOW, { linkOnlyAt: linkedAt })).toBe(true)
  })

  it('still rejects an issue that falls outside the window regardless', () => {
    const old = issue(NOW - 90 * DAY, NOW - 30 * DAY)
    expect(passesRecency(old, 'updated', 'today', NOW)).toBe(false)
  })
})

// The regressions this file exists to pin: a link-only bump means `updatedAt`
// cannot testify, NOT that nothing happened. Everything below was previously
// hidden by an unconditional `return false`.
describe('passesRecency — evidence a link-only bump must not bury', () => {
  const linkedAt = new Date(NOW - 3600 * 1000).toISOString()
  const linkOnly = { linkOnlyAt: linkedAt }

  it('keeps an issue CREATED inside the window that was then linked to', () => {
    // Measured as 8 of the 17 issues created in a live 7-day window.
    const born = issue(NOW - 2 * 3600 * 1000, NOW - 3600 * 1000)
    expect(passesRecency(born, 'updated', 'today', NOW, linkOnly)).toBe(true)
  })

  it('keeps an issue COMMENTED inside the window that was then linked to', () => {
    const commented = {
      ...issue(NOW - 90 * DAY, NOW - 3600 * 1000),
      lastCommentAt: new Date(NOW - 2 * 3600 * 1000).toISOString(),
    }
    expect(passesRecency(commented, 'updated', 'today', NOW, linkOnly)).toBe(true)
  })

  it('leaves a comment older than the window unable to save it', () => {
    const commented = {
      ...issue(NOW - 90 * DAY, NOW - 3600 * 1000),
      lastCommentAt: new Date(NOW - 30 * DAY).toISOString(),
    }
    expect(passesRecency(commented, 'updated', 'today', NOW, linkOnly)).toBe(false)
  })
})

describe("passesRecency — a child's activity counts as the parent's", () => {
  const parent = issue(NOW - 90 * DAY, NOW - 30 * DAY)
  const childMovedToday = new Date(NOW - 3600 * 1000).toISOString()

  it('keeps a parent whose own updatedAt is stale but whose child just moved', () => {
    expect(passesRecency(parent, 'updated', 'today', NOW)).toBe(false)
    expect(
      passesRecency(parent, 'updated', 'today', NOW, { childActivityAt: childMovedToday }),
    ).toBe(true)
  })

  it('does not let a stale child rescue a stale parent', () => {
    const childMovedLastMonth = new Date(NOW - 30 * DAY).toISOString()
    expect(
      passesRecency(parent, 'updated', 'today', NOW, { childActivityAt: childMovedLastMonth }),
    ).toBe(false)
  })

  it('leaves "created" mode answering only its own question', () => {
    // A child moving does not make the parent newly created.
    expect(
      passesRecency(parent, 'created', 'today', NOW, { childActivityAt: childMovedToday }),
    ).toBe(false)
  })
})

describe('parseRecencyWindow', () => {
  it.each(['any', 'today', '1h', '24h', '7d', '30d', '365d'])('accepts %s', (raw) => {
    expect(parseRecencyWindow(raw)).toBe(raw)
  })

  // The type says `${number}h`, which also admits 1.5, -2 and 1e3 — so the
  // type is a guardrail and this is the gate.
  it.each([
    ['a bare number', '7'],
    ['an unknown unit', '7w'],
    ['a fraction', '1.5h'],
    ['a negative', '-2d'],
    ['exponent notation', '1e3h'],
    ['zero', '0d'],
    ['empty', ''],
    ['null', null],
    ['a number', 7],
  ])('rejects %s', (_name, raw) => {
    expect(parseRecencyWindow(raw)).toBeNull()
  })

  it('rejects spans past the cap but accepts the cap itself', () => {
    expect(parseRecencyWindow(`${MAX_HOURS}h`)).toBe(`${MAX_HOURS}h`)
    expect(parseRecencyWindow(`${MAX_HOURS + 1}h`)).toBeNull()
    expect(parseRecencyWindow(`${MAX_DAYS}d`)).toBe(`${MAX_DAYS}d`)
    expect(parseRecencyWindow(`${MAX_DAYS + 1}d`)).toBeNull()
  })
})

describe('recencyCutoff — arbitrary spans', () => {
  it.each([
    ['1h', 3600_000],
    ['6h', 6 * 3600_000],
    ['24h', 24 * 3600_000],
    ['3d', 3 * DAY],
    ['90d', 90 * DAY],
  ] as [RecencyWindow, number][])('%s reaches back the right distance', (w, back) => {
    expect(recencyCutoff(w, NOW)).toBe(NOW - back)
  })

  // "today" at 14:30 covers 14.5 hours; "24h" reaches into yesterday. They
  // answer different questions, so neither stands in for the other.
  it('keeps today and 24h distinct', () => {
    expect(recencyCutoff('today', NOW)).not.toBe(recencyCutoff('24h', NOW))
    expect(recencyCutoff('24h', NOW)).toBeLessThan(recencyCutoff('today', NOW) as number)
  })

  // Fails open: a bad value must not hide every issue.
  it('treats an unparseable window as no filter', () => {
    expect(recencyCutoff('7w' as RecencyWindow, NOW)).toBeNull()
    expect(passesRecency(issue(0, 0), 'updated', '7w' as RecencyWindow, NOW)).toBe(true)
  })
})
