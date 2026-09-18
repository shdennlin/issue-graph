import { describe, expect, it } from 'vitest'
import { stageVisits, type StageEvent } from './stageHistory.js'

const DAY = 86_400_000
const T0 = 1_800_000_000_000
const NOW = T0 + 20 * DAY

const ev = (stageKey: string, dayOffset: number): StageEvent => ({ stageKey, at: T0 + dayOffset * DAY })

describe('stageVisits', () => {
  it('measures a past stage by the gap to the next arrival', () => {
    // The whole point: before this, six of seven stages had no time on them,
    // so the pipeline showed a position without a journey.
    const v = stageVisits([ev('discuss', 0), ev('spec', 3), ev('impl', 8)], NOW)
    expect(v.get('discuss')).toMatchObject({ days: 3, leftAt: T0 + 3 * DAY, current: false })
    expect(v.get('spec')).toMatchObject({ days: 5, current: false })
  })

  it('measures the current stage against now', () => {
    const v = stageVisits([ev('discuss', 0), ev('impl', 8)], NOW)
    expect(v.get('impl')).toMatchObject({ days: 12, leftAt: null, current: true })
  })

  it('marks exactly one stage as current', () => {
    const v = stageVisits([ev('a', 0), ev('b', 1), ev('c', 2)], NOW)
    expect([...v.values()].filter((x) => x.current).map((x) => x.stageKey)).toEqual(['c'])
  })

  it('reports the LAST visit when a workstream came back', () => {
    // Going round twice is the shape of a review that failed. The question the
    // pipeline answers is present tense — "how long has it been here" — so the
    // latest visit is the one still true.
    const v = stageVisits([ev('spec', 0), ev('impl', 2), ev('spec', 5)], NOW)
    expect(v.get('spec')).toMatchObject({ enteredAt: T0 + 5 * DAY, days: 15, current: true })
  })

  it('counts the visits, so a second lap is visible rather than averaged away', () => {
    const v = stageVisits([ev('spec', 0), ev('impl', 2), ev('spec', 5)], NOW)
    expect(v.get('spec')?.visits).toBe(2)
    expect(v.get('impl')?.visits).toBe(1)
  })

  it('handles a single event', () => {
    expect(stageVisits([ev('a', 0)], NOW).get('a')).toMatchObject({ days: 20, current: true })
  })

  it('returns nothing for a workstream that has never been staged', () => {
    expect(stageVisits([], NOW).size).toBe(0)
  })

  it('sorts defensively rather than trusting arrival order', () => {
    const v = stageVisits([ev('impl', 8), ev('discuss', 0)], NOW)
    expect(v.get('discuss')?.days).toBe(8)
    expect(v.get('impl')?.current).toBe(true)
  })

  it('never reports a negative age when the clock moved backwards', () => {
    // Two writes either side of an NTP correction. A negative age would render
    // as "-2d here", which reads as a bug rather than as a clock problem.
    const v = stageVisits([ev('a', 0)], T0 - 2 * DAY)
    expect(v.get('a')?.days).toBe(0)
  })
})
