import { Hono } from 'hono'
import { getBackend } from '../sources/factory.js'

interface CacheEntry { detail: unknown; ts: number }
const detailCache = new Map<string, CacheEntry>()
const TTL_MS = 10 * 60 * 1000

export const projectRoutes = new Hono()

projectRoutes.get('/api/projects/:id', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    return c.json({ error: { code: 'bad_request', message: 'Missing project id' } }, 400)
  }

  // `?fresh=1` bypasses the TTL cache — sent after an explicit sync so newly
  // changed milestones/progress are reflected instead of a cached copy.
  const fresh = c.req.query('fresh') === '1'
  const cached = detailCache.get(id)
  if (!fresh && cached && Date.now() - cached.ts < TTL_MS) {
    return c.json({ data: cached.detail })
  }

  const backend = getBackend()
  if (typeof backend.fetchProjectDetail !== 'function') {
    return c.json({ error: { code: 'not_supported', message: 'Backend does not expose project details.' } }, 501)
  }

  try {
    const detail = await backend.fetchProjectDetail(id)
    detailCache.set(id, { detail, ts: Date.now() })
    return c.json({ data: detail })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: { code: 'fetch_failed', message } }, 502)
  }
})
