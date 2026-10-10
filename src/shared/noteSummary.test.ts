import { describe, expect, it } from 'vitest'
import { noteSummary } from './noteSummary.js'

describe('noteSummary', () => {
  it('takes the first line and leaves the rest alone', () => {
    expect(noteSummary('Rewrite auth so SSO can land.\n\nDecided on the 9/17 call.')).toBe(
      'Rewrite auth so SSO can land.',
    )
  })

  it('skips leading blank lines rather than returning nothing', () => {
    // A note that opens with a newline still has a subject; it is on line two.
    expect(noteSummary('\n\n  Why this exists')).toBe('Why this exists')
  })

  it('strips a markdown heading marker', () => {
    // "## Why this exists" is a worse summary than "Why this exists", and a
    // note written as markdown very often opens with one.
    expect(noteSummary('## Why this exists\nbody')).toBe('Why this exists')
    expect(noteSummary('> quoted opener')).toBe('quoted opener')
  })

  it('cuts on a word boundary when the line is long', () => {
    const line = 'word '.repeat(60).trim()
    const out = noteSummary(line)!
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(121)
    expect(out.slice(0, -1).trim().endsWith('word')).toBe(true)
  })

  it('cuts hard rather than returning almost nothing for one long word', () => {
    // The word-boundary rule must not fire when the only space is at position
    // 3 — that would turn a 200-character line into "the…".
    const out = noteSummary(`the ${'x'.repeat(200)}`)!
    expect(out.length).toBeGreaterThan(100)
  })

  it('is null for a note that is absent or only whitespace', () => {
    expect(noteSummary(null)).toBeNull()
    expect(noteSummary(undefined)).toBeNull()
    expect(noteSummary('   \n\n  ')).toBeNull()
  })
})
