import { describe, it, expect } from 'vitest'
import { coerceStaleDays, coerceTheme, coerceView } from './preferences.js'

// These read values a user can edit by hand in devtools, and that survive
// across releases — so a stored value can be from an older build that had a
// view or theme this one no longer knows about. Every coercion returns null
// for anything it does not recognise, and the caller substitutes its default.
describe('coerceView', () => {
  it('accepts every real view id', () => {
    for (const v of ['dependency', 'mix', 'project', 'milestone', 'designdoc']) {
      expect(coerceView(v), v).toBe(v)
    }
  })

  it('rejects a view id this build does not know', () => {
    expect(coerceView('bucket')).toBeNull()
    expect(coerceView('timeline')).toBeNull()
  })

  it('rejects absent and malformed values', () => {
    expect(coerceView(null)).toBeNull()
    expect(coerceView(undefined)).toBeNull()
    expect(coerceView('')).toBeNull()
    expect(coerceView('Dependency')).toBeNull()
  })
})

describe('coerceTheme', () => {
  it('accepts the three theme modes', () => {
    expect(coerceTheme('light')).toBe('light')
    expect(coerceTheme('dark')).toBe('dark')
    expect(coerceTheme('auto')).toBe('auto')
  })

  it('rejects anything else', () => {
    expect(coerceTheme('system')).toBeNull()
    expect(coerceTheme(null)).toBeNull()
    expect(coerceTheme('')).toBeNull()
  })
})

describe('coerceStaleDays', () => {
  it('accepts integers inside the supported range', () => {
    expect(coerceStaleDays('14')).toBe(14)
    expect(coerceStaleDays('1')).toBe(1)
    expect(coerceStaleDays('365')).toBe(365)
  })

  it('rejects values outside the range rather than clamping', () => {
    expect(coerceStaleDays('0')).toBeNull()
    expect(coerceStaleDays('366')).toBeNull()
    expect(coerceStaleDays('-5')).toBeNull()
  })

  it('rejects non-integers, so 2.5 is not silently truncated to 2', () => {
    expect(coerceStaleDays('2.5')).toBeNull()
    expect(coerceStaleDays('fourteen')).toBeNull()
    expect(coerceStaleDays('')).toBeNull()
    expect(coerceStaleDays(null)).toBeNull()
  })
})
