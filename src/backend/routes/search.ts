import { Hono } from 'hono'
import { readIssueTexts, readIssueTextBackfilled } from '../cache.js'
import { kickBackgroundSync } from '../sync.js'
import { searchDescriptions } from '../lib/textSearch.js'

export const searchRoutes = new Hono()

const MIN_QUERY = 2
const MAX_QUERY = 200

/**
 * Description search for the quick switcher. Titles are matched in the browser
 * (the issue list is already there); descriptions are not, by design — they
 * stay server-side so /api/graph does not carry ~2.7x its own weight in text.
 * The browser gets only the identifier and a snippet per hit.
 *
 * Workspace-scoped by the `?w=` middleware like every other /api route.
 */
searchRoutes.get('/api/search', (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, MAX_QUERY)
  // Until the first full sync has collected descriptions there is nothing to
  // search, and an empty list would look like "no such text". Say so, and make
  // sure the sync that fixes it is running.
  const indexing = !readIssueTextBackfilled()
  if (indexing) kickBackgroundSync()
  if (q.length < MIN_QUERY) return c.json({ data: { query: q, hits: [], indexing } })
  const hits = searchDescriptions(readIssueTexts(), q)
  return c.json({ data: { query: q, hits, indexing } })
})
