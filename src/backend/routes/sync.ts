import { Hono } from 'hono'
import { syncOnce } from '../sync.js'
import { getDb } from '../db.js'
import type { SyncLogEntry } from '@shared/types.js'

export const syncRoutes = new Hono()

syncRoutes.post('/api/sync', async (c) => {
  const result = await syncOnce({ force: true })
  return c.json(result, result.ok ? 200 : 500)
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
