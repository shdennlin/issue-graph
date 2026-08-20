import { createHmac } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// In-memory stand-in for cache_meta so the route can be exercised without a
// real workspace DB. Also lets each case set the stored secret directly.
const meta = new Map<string, string>()
vi.mock('../cache.js', () => ({
  readMeta: (k: string) => meta.get(k) ?? null,
  writeMeta: (k: string, v: string) => void meta.set(k, v),
}))

const syncOnce = vi.fn(async () => ({ ok: true }))
vi.mock('../sync.js', () => ({ syncOnce: (...a: unknown[]) => syncOnce(...(a as [])) }))

const publish = vi.fn()
vi.mock('../lib/eventBus.js', () => ({
  publish: (...a: unknown[]) => publish(...(a as [])),
  BUS_EVENT: { ISSUES_CHANGED: 'issues-changed' },
}))

import { webhookRoutes, WEBHOOK_STAT_OK_COUNT, WEBHOOK_STAT_REJECT_COUNT } from './webhooks.js'
import { __resetDebounceForTests } from '../lib/webhookDebounce.js'
import { __resetRateLimitForTests } from '../lib/rateLimit.js'
import { setRosterSource } from '../lib/env.js'
import type { WorkspaceRow } from '../controlStore.js'

const SECRET = 'lin_wh_secret'

// The secret lives on the workspace row now, not in cache_meta, so these cases
// drive the real injection seam instead of mocking a second store. An empty
// roster is a genuine state (nothing configured yet), which is what the
// unconfigured case below exercises.
function useRoster(webhookSecret: string | null): void {
  const row: WorkspaceRow = {
    id: 'ws1',
    name: 'Workspace One',
    backend: 'linear',
    apiKey: 'lin_api_x',
    webhookSecret,
    teamId: null,
    sortOrder: 0,
    createdAt: 0,
  }
  setRosterSource({ rows: () => [row], readActive: () => 'ws1', clearActive: () => undefined })
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'update',
    type: 'Issue',
    webhookTimestamp: Date.now(),
    ...overrides,
  })
}

function post(raw: string, signature?: string) {
  return webhookRoutes.request('/api/webhooks/linear', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'linear-signature': signature } : {}),
    },
    body: raw,
  })
}

function sign(raw: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(raw).digest('hex')
}

describe('POST /api/webhooks/linear', () => {
  beforeEach(() => {
    meta.clear()
    useRoster(SECRET)
    syncOnce.mockClear()
    publish.mockClear()
    __resetDebounceForTests()
    __resetRateLimitForTests()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts a correctly signed, fresh payload', async () => {
    const raw = body()
    const res = await post(raw, sign(raw))
    expect(res.status).toBe(200)
  })

  it('rejects a payload whose body was altered after signing', async () => {
    const raw = body()
    const res = await post(`${raw} `, sign(raw))
    expect(res.status).toBe(401)
  })

  it('rejects a signature from a different secret', async () => {
    const raw = body()
    const res = await post(raw, sign(raw, 'attacker'))
    expect(res.status).toBe(401)
  })

  it('rejects a missing signature header', async () => {
    expect((await post(body())).status).toBe(401)
  })

  it('rejects a replayed timestamp', async () => {
    const raw = body({ webhookTimestamp: Date.now() - 120_000 })
    const res = await post(raw, sign(raw))
    expect(res.status).toBe(401)
  })

  // The endpoint is public. A distinct status or message for "no secret here"
  // would tell an unauthenticated caller about this instance's configuration.
  it('rejects with a plain 401 when no secret is configured', async () => {
    useRoster(null)
    const raw = body()
    const res = await post(raw, sign(raw))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    // Asserted through the public accessor, not the store: rejections are
    // counted in memory and flushed sparsely, so the store is deliberately
    // stale between flushes.
    const { readWebhookStats } = await import('./webhooks.js')
    expect(readWebhookStats().last_reject_reason).toBe('unconfigured')
  })

  it('never syncs on a rejected request', async () => {
    const raw = body()
    await post(raw, sign(raw, 'attacker'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(syncOnce).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('syncs and notifies clients once the debounce elapses', async () => {
    const raw = body()
    await post(raw, sign(raw))
    expect(syncOnce).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(syncOnce).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'issues-changed' }),
    )
  })

  it('collapses a burst of accepted webhooks into one sync', async () => {
    for (let i = 0; i < 5; i++) {
      const raw = body({ n: i })
      await post(raw, sign(raw))
    }
    await vi.advanceTimersByTimeAsync(2000)
    expect(syncOnce).toHaveBeenCalledTimes(1)
  })

  it('counts accepted deliveries for the settings status panel', async () => {
    for (let i = 0; i < 3; i++) {
      const raw = body({ n: i })
      await post(raw, sign(raw))
    }
    expect(meta.get(WEBHOOK_STAT_OK_COUNT)).toBe('3')
  })
})

// Everything below bounds what an unauthenticated caller can cost us. The
// endpoint is publicly reachable and its hostname is discoverable via
// Certificate Transparency, so "rejecting is cheap" is not the same as free.
describe('POST /api/webhooks/linear — abuse bounds', () => {
  beforeEach(() => {
    meta.clear()
    useRoster(SECRET)
    syncOnce.mockClear()
    __resetDebounceForTests()
    __resetRateLimitForTests()
  })

  it('refuses an oversized body before reading or verifying it', async () => {
    const res = await webhookRoutes.request('/api/webhooks/linear', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024) },
      body: body(),
    })
    expect(res.status).toBe(413)
  })

  it('accepts a normal-sized signed payload', async () => {
    const raw = body()
    const res = await post(raw, sign(raw))
    expect(res.status).toBe(200)
  })

  it('answers 429 once the burst allowance is spent', async () => {
    const codes: number[] = []
    for (let i = 0; i < 40; i++) {
      codes.push((await post(body({ n: i }))).status)
    }
    expect(codes).toContain(429)
  })

  // Persisting a counter per rejected request is a disk write an unauthorized
  // caller controls. Rejections are counted in memory and flushed sparsely.
  it('does not write to the store on every rejection', async () => {
    for (let i = 0; i < 15; i++) await post(body({ n: i }))
    const reject = Number(meta.get(WEBHOOK_STAT_REJECT_COUNT) ?? '0')
    expect(reject).toBeLessThan(15)
  })

  it('still surfaces rejections in the settings summary', async () => {
    await post(body())
    const { readWebhookStats } = await import('./webhooks.js')
    expect(readWebhookStats().reject_count).toBeGreaterThan(0)
  })
})
