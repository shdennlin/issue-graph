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

import { webhookRoutes, WEBHOOK_SECRET_KEY, WEBHOOK_STAT_OK_COUNT, WEBHOOK_STAT_LAST_REASON } from './webhooks.js'
import { __resetDebounceForTests } from '../lib/webhookDebounce.js'

const SECRET = 'lin_wh_secret'

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
    meta.set(WEBHOOK_SECRET_KEY, SECRET)
    syncOnce.mockClear()
    publish.mockClear()
    __resetDebounceForTests()
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
    meta.delete(WEBHOOK_SECRET_KEY)
    const raw = body()
    const res = await post(raw, sign(raw))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(meta.get(WEBHOOK_STAT_LAST_REASON)).toBe('unconfigured')
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
