import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetDebounceForTests, scheduleWorkspaceSync } from './webhookDebounce.js'

describe('scheduleWorkspaceSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetDebounceForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the job once the quiet period elapses', async () => {
    const job = vi.fn(async () => {})
    scheduleWorkspaceSync('ws1', job, 2000)
    expect(job).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(job).toHaveBeenCalledTimes(1)
  })

  // Linear fires one webhook per changed entity, so editing ten issues in bulk
  // arrives as ten requests within a second. Syncing per request would hammer
  // the API for a result that one sync already covers.
  it('collapses a burst into a single run', async () => {
    const job = vi.fn(async () => {})
    for (let i = 0; i < 10; i++) {
      scheduleWorkspaceSync('ws1', job, 2000)
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(job).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(job).toHaveBeenCalledTimes(1)
  })

  it('keeps a separate timer per workspace', async () => {
    const a = vi.fn(async () => {})
    const b = vi.fn(async () => {})
    scheduleWorkspaceSync('ws1', a, 2000)
    scheduleWorkspaceSync('ws2', b, 2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('runs again for events that arrive after a run completed', async () => {
    const job = vi.fn(async () => {})
    scheduleWorkspaceSync('ws1', job, 2000)
    await vi.advanceTimersByTimeAsync(2000)
    scheduleWorkspaceSync('ws1', job, 2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(job).toHaveBeenCalledTimes(2)
  })

  it('swallows a job rejection so one failure cannot kill later runs', async () => {
    const job = vi.fn(async () => {
      throw new Error('linear down')
    })
    scheduleWorkspaceSync('ws1', job, 2000)
    await expect(vi.advanceTimersByTimeAsync(2000)).resolves.not.toThrow()

    const ok = vi.fn(async () => {})
    scheduleWorkspaceSync('ws1', ok, 2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(ok).toHaveBeenCalledTimes(1)
  })
})
