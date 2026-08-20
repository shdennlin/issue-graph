import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRateLimitForTests, allowRequest } from './rateLimit.js'

describe('allowRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetRateLimitForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows a burst up to the bucket capacity', () => {
    for (let i = 0; i < 10; i++) expect(allowRequest('k', 10, 1)).toBe(true)
  })

  it('refuses once the burst is spent', () => {
    for (let i = 0; i < 10; i++) allowRequest('k', 10, 1)
    expect(allowRequest('k', 10, 1)).toBe(false)
  })

  it('refills over time at the configured rate', () => {
    for (let i = 0; i < 10; i++) allowRequest('k', 10, 1)
    expect(allowRequest('k', 10, 1)).toBe(false)
    vi.advanceTimersByTime(2000) // 2s at 1 token/s
    expect(allowRequest('k', 10, 1)).toBe(true)
    expect(allowRequest('k', 10, 1)).toBe(true)
    expect(allowRequest('k', 10, 1)).toBe(false)
  })

  it('never refills beyond capacity', () => {
    allowRequest('k', 10, 1)
    vi.advanceTimersByTime(3_600_000)
    for (let i = 0; i < 10; i++) expect(allowRequest('k', 10, 1)).toBe(true)
    expect(allowRequest('k', 10, 1)).toBe(false)
  })

  it('keeps separate buckets per key', () => {
    for (let i = 0; i < 10; i++) allowRequest('a', 10, 1)
    expect(allowRequest('a', 10, 1)).toBe(false)
    expect(allowRequest('b', 10, 1)).toBe(true)
  })
})
