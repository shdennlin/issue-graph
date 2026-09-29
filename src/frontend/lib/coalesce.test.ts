import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { coalesce } from './coalesce'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('coalesce', () => {
  it('runs once for a burst', () => {
    const fn = vi.fn()
    const c = coalesce(fn, 1000)
    for (let i = 0; i < 20; i++) c.call()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('still fires under a steady stream — the delay is bounded, not reset', () => {
    // A trailing debounce would never fire here, and the board would freeze
    // exactly while an agent is busy on it.
    const fn = vi.fn()
    const c = coalesce(fn, 1000)
    for (let t = 0; t < 3000; t += 200) {
      c.call()
      vi.advanceTimersByTime(200)
    }
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('cancel drops a pending call', () => {
    const fn = vi.fn()
    const c = coalesce(fn, 1000)
    c.call()
    c.cancel()
    vi.advanceTimersByTime(2000)
    expect(fn).not.toHaveBeenCalled()
  })
})
