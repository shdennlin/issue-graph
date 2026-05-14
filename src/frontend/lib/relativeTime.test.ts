import { describe, expect, it } from 'vitest'
import { formatRelative } from './relativeTime'

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
