import { Hono } from 'hono'
import { getBackend } from '../sources/factory.js'
import { readCachedIssues } from '../cache.js'
import { readViewerCached } from '../sync.js'

interface CacheEntry { detail: unknown; ts: number }
const detailCache = new Map<string, CacheEntry>()
const TTL_MS = 10 * 60 * 1000

export const issueRoutes = new Hono()

issueRoutes.get('/api/issues/:identifier', async (c) => {
  const identifier = c.req.param('identifier')
  // Identifier → backend id via cached lookup.
  const issues = readCachedIssues()
  const match = issues.find((i) => i.identifier === identifier)
  if (!match) return c.json({ error: { code: 'not_found', message: `No cached issue ${identifier}` } }, 404)

  const cached = detailCache.get(identifier)
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return c.json({ data: cached.detail })
  }

  try {
    const detail = await getBackend().fetchIssueDetail(match.id)
    detailCache.set(identifier, { detail, ts: Date.now() })
    return c.json({ data: detail })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: { code: 'fetch_failed', message } }, 502)
  }
})

issueRoutes.get('/api/me', (c) => {
  const cached = readCachedIssues()
  const viewer = readViewerCached()
  return c.json({ viewer, issuesCached: cached.length })
})
