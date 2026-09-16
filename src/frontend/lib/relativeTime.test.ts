import { describe, expect, it } from 'vitest'
import { compactAge, formatRelative } from './relativeTime'

const NOW = new Date('2026-05-11T18:00:00Z').getTime()

describe('formatRelative', () => {
  it('returns "just now" within 10s', () => {
    expect(formatRelative(NOW - 5_000, NOW)).toBe('just now')
  })
  it('seconds within a minute', () => {
    expect(formatRelative(NOW - 45_000, NOW)).toBe('45s ago')
  })
  it('minutes within an hour', () => {
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe('5 min ago')
  })
  it('hours within a day', () => {
    expect(formatRelative(NOW - 3 * 3600_000, NOW)).toBe('3 hr ago')
  })
  it('yesterday for ~1 day ago', () => {
    expect(formatRelative(NOW - 24 * 3600_000, NOW)).toBe('yesterday')
  })
  it('days within a week', () => {
    expect(formatRelative(NOW - 3 * 24 * 3600_000, NOW)).toBe('3 days ago')
  })
  it('absolute date past a week', () => {
    const out = formatRelative(NOW - 14 * 24 * 3600_000, NOW)
    expect(out).toMatch(/\d{4}/)
  })
})

describe('compactAge', () => {
  const NOW = new Date(2026, 7, 27, 12, 0, 0).getTime()
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it.each([
    ['under a minute', 30_000, { value: 0, unit: 'm' }],
    ['minutes', 45 * MIN, { value: 45, unit: 'm' }],
    ['hours', 5 * HOUR, { value: 5, unit: 'h' }],
    ['days', 9 * DAY, { value: 9, unit: 'd' }],
  ] as [string, number, { value: number; unit: string }][])('reports %s', (_n, ago, expected) => {
    expect(compactAge(NOW - ago, NOW)).toEqual(expected)
  })

  // Rounds down: overstating an age is worse than understating it, because the
  // number gets read against a filter window the user chose.
  it('rounds down at every boundary', () => {
    expect(compactAge(NOW - (119 * MIN), NOW)).toEqual({ value: 1, unit: 'h' })
    expect(compactAge(NOW - (59 * MIN), NOW)).toEqual({ value: 59, unit: 'm' })
    expect(compactAge(NOW - (47 * HOUR), NOW)).toEqual({ value: 1, unit: 'd' })
  })

  it('clamps a future timestamp to zero rather than going negative', () => {
    expect(compactAge(NOW + DAY, NOW)).toEqual({ value: 0, unit: 'm' })
  })
})
