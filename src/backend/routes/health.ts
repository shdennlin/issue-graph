import { Hono } from 'hono'
import { getDb } from '../db.js'
import { readLastSyncMs } from '../cache.js'

export const healthRoutes = new Hono()

healthRoutes.get('/api/health', (c) => c.json({ ok: true }))

healthRoutes.get('/api/ready', (c) => {
  try {
    const row = getDb()
      .prepare('SELECT status FROM sync_log ORDER BY started_at DESC LIMIT 1')
      .get() as { status?: string } | undefined
    const lastSync = readLastSyncMs()
    const ready = lastSync !== null || (row?.status === 'success' || row?.status === 'rate_limited')
    return c.json({ ok: ready, lastSyncMs: lastSync, lastStatus: row?.status ?? null }, ready ? 200 : 503)
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 503)
  }
})
