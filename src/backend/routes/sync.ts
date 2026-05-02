import { Hono } from 'hono'
import { syncOnce } from '../sync.js'
import { getDb } from '../db.js'
import { readExtendedScopeDays, writeExtendedScopeDays, resetCache } from '../cache.js'
import { getLogger } from '../lib/log.js'
import type { SyncLogEntry } from '@shared/types.js'

export const syncRoutes = new Hono()

syncRoutes.post('/api/sync', async (c) => {
  const result = await syncOnce({ force: true })
  return c.json(result, result.ok ? 200 : 500)
})

/**
 * Wipe issue + label cache + workspace-tied meta (designdoc payload, workflow
 * states, last_sync_ms). Use after switching LINEAR_API_KEY to a different
 * workspace, or to recover from a corrupted cache. Snapshots, annotations,
 * and sync history are preserved.
 *
 * Next sync will rebuild from scratch.
 */
syncRoutes.post('/api/reset-cache', (c) => {
  const cleared = resetCache()
  getLogger().warn(cleared, 'cache reset via /api/reset-cache')
  return c.json({ ok: true, cleared })
})

/**
 * Lazy-fetch extension. Frontend calls this when the user explicitly checks
 * Canceled or Completed in the state filter — we persist `days` to cache_meta
 * and trigger a fresh sync that pulls those issue types within the window.
 *
 * Body: { days: number }  // 0 = clear extension; up to 365
 */
syncRoutes.post('/api/sync/extend', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { days?: number }
  const days = Number(body.days ?? 0)
  if (!Number.isFinite(days) || days < 0 || days > 365) {
    return c.json({ ok: false, error: 'days must be 0–365' }, 400)
  }
  const current = readExtendedScopeDays()
  // Avoid an unnecessary network roundtrip when the requested window already
  // fits inside the current setting (e.g. user re-checks Canceled).
  if (days <= current && current > 0) {
    return c.json({ ok: true, days: current, refetched: false })
  }
  writeExtendedScopeDays(days)
  if (days === 0) {
    // Cleared — next normal sync will refresh; don't force one here.
    return c.json({ ok: true, days: 0, refetched: false })
  }
  const result = await syncOnce({ force: true })
  return c.json({ ok: result.ok, days, refetched: true, count: result.count }, result.ok ? 200 : 500)
})

syncRoutes.get('/api/sync/extend', (c) => {
  return c.json({ days: readExtendedScopeDays() })
})

syncRoutes.get('/api/sync-history', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const rows = getDb()
    .prepare(
      `SELECT id, started_at as startedAt, finished_at as finishedAt, status, backend,
              issues_count as issuesCount, error_message as errorMessage
       FROM sync_log ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit) as SyncLogEntry[]
  return c.json({ entries: rows })
})
